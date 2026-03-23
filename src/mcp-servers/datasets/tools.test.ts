import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import registerTools from './tools.ts'

/**
 * Fake Data Fair API server that returns canned responses based on the URL path.
 * Routes are matched longest-pattern-first to avoid ambiguity.
 */
const routes: Record<string, (url: URL) => any> = {}

const fakeApi = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, 'http://localhost')
  // Sort patterns by length descending so more specific routes match first
  const sortedPatterns = Object.keys(routes).sort((a, b) => b.length - a.length)
  for (const pattern of sortedPatterns) {
    if (url.pathname.includes(pattern)) {
      const body = JSON.stringify(routes[pattern](url))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }
  }
  res.writeHead(404)
  res.end('Not found: ' + url.pathname)
})

let client: InstanceType<typeof Client>
let server: McpServer

before(async () => {
  // Start fake API server and configure portalUrl to point to it
  await new Promise<void>(resolve => fakeApi.listen(0, resolve))
  const addr = fakeApi.address() as import('node:net').AddressInfo
  process.env.NODE_CONFIG_DIR = process.cwd() + '/config'
  process.env.NODE_CONFIG = JSON.stringify({ portalUrl: `http://localhost:${addr.port}` })

  // Force config module reload with the new portalUrl
  // We dynamically import config so the env vars above are picked up
  const configMod = await import('#config')
  Object.assign(configMod.default, { portalUrl: `http://localhost:${addr.port}` })

  server = new McpServer({ name: 'test', version: '0.0.0' })
  registerTools(server)

  client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])
})

after(async () => {
  await client.close()
  await server.close()
  fakeApi.closeAllConnections()
  await new Promise<void>(resolve => fakeApi.close(() => resolve()))
})

describe('search_datasets', () => {
  it('should search datasets and return formatted results', async () => {
    routes['/catalog/datasets'] = (url) => ({
      count: 2,
      results: [
        { id: 'ds1', title: 'Entreprises', summary: 'Liste des entreprises', page: 'https://example.com/datasets/ds1' },
        { id: 'ds2', title: 'Logements', page: 'https://example.com/datasets/ds2' }
      ]
    })

    const result = await client.callTool({ name: 'search_datasets', arguments: { query: 'entreprises' } })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.count, 2)
    assert.equal(sc.datasets.length, 2)
    assert.equal(sc.datasets[0].id, 'ds1')
    assert.equal(sc.datasets[0].title, 'Entreprises')
    assert.equal(sc.datasets[0].summary, 'Liste des entreprises')
    assert.equal(sc.datasets[0].link, 'https://example.com/datasets/ds1')
    assert.equal(sc.datasets[1].summary, undefined)

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('2 datasets found.'))
    assert.ok(text.includes('Entreprises (id: ds1)'))
    assert.ok(text.includes('Liste des entreprises'))
    assert.ok(text.includes('https://example.com/datasets/ds1'))
    assert.ok(text.includes('Logements (id: ds2)'))
    assert.ok(!text.includes('{'))  // No JSON
  })
})

describe('describe_dataset', () => {
  it('should return dataset metadata with schema and sample lines', async () => {
    routes['/datasets/ds1/lines'] = () => ({
      results: [
        { _id: 'abc', _i: 1, _rand: 123, nom: 'ACME', ville: 'Paris' },
        { _id: 'def', _i: 2, _rand: 456, nom: 'Globex', ville: 'Lyon' },
        { _id: 'ghi', _i: 3, _rand: 789, nom: 'Initech', ville: 'Paris' }
      ]
    })
    routes['/datasets/ds1'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds1',
        title: 'Entreprises',
        slug: 'entreprises',
        page: 'https://example.com/datasets/ds1',
        count: 1000,
        summary: 'Liste des entreprises',
        keywords: ['entreprise', 'siège'],
        license: { href: 'https://license.example.com', title: 'Open License' },
        schema: [
          { key: '_id', type: 'string' },
          { key: '_i', type: 'integer' },
          { key: '_rand', type: 'integer' },
          { key: 'nom', type: 'string', title: 'Nom', 'x-concept': { title: 'Nom entreprise' } },
          { key: 'ville', type: 'string', title: 'Ville', enum: ['Paris', 'Lyon'], 'x-labels': { Paris: 'Paris', Lyon: 'Lyon' } }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds1' } })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.id, 'ds1')
    assert.equal(sc.title, 'Entreprises')
    assert.equal(sc.slug, 'entreprises')
    assert.equal(sc.count, 1000)
    assert.equal(sc.license.title, 'Open License')
    assert.equal(sc.schema.length, 2)
    assert.equal(sc.schema[0].key, 'nom')
    assert.equal(sc.schema[0].concept, 'Nom entreprise')
    assert.equal(sc.schema[1].key, 'ville')
    assert.deepEqual(sc.schema[1].enum, ['Paris', 'Lyon'])
    assert.deepEqual(sc.schema[1].labels, { Paris: 'Paris', Lyon: 'Lyon' })
    assert.equal(sc.sampleLines.length, 3)
    assert.equal(sc.sampleLines[0].nom, 'ACME')
    assert.equal(sc.sampleLines[0]._id, undefined)

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('Dataset: Entreprises'))
    assert.ok(text.includes('ID: ds1'))
    assert.ok(text.includes('Rows: 1000'))
    assert.ok(text.includes('License: Open License'))
    assert.ok(text.includes('Keywords: entreprise, siège'))
    assert.ok(text.includes('- nom (string): Nom [concept: Nom entreprise]'))
    assert.ok(text.includes('[labels: Paris=Paris, Lyon=Lyon]'))
    assert.ok(text.includes('Sample data:'))
    assert.ok(text.includes('nom,ville'))
    assert.ok(text.includes('ACME,Paris'))
    assert.ok(!text.startsWith('{'))  // No JSON
  })

  it('should truncate large enum arrays', async () => {
    const largeEnum = Array.from({ length: 50 }, (_, i) => `val${i}`)
    routes['/datasets/ds2/lines'] = () => ({ results: [{ code: 'val0' }] })
    routes['/datasets/ds2'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds2',
        title: 'Large enums',
        page: 'https://example.com/datasets/ds2',
        count: 100,
        schema: [
          { key: 'code', type: 'string', enum: largeEnum },
          { key: 'small', type: 'string', enum: ['a', 'b'] }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds2' } })
    const sc = result.structuredContent as any

    assert.equal(sc.schema[0].enum.length, 20)
    assert.equal(sc.schema[0].enumTruncated, true)
    assert.equal(sc.schema[0].enumTotal, 50)
    assert.deepEqual(sc.schema[1].enum, ['a', 'b'])
    assert.equal(sc.schema[1].enumTruncated, undefined)

    // Text should mention truncation
    const text = (result.content as any)[0].text
    assert.ok(text.includes('(50 total)'))
  })

  it('should truncate very long descriptions', async () => {
    const longDescription = 'A'.repeat(3000)
    routes['/datasets/ds3/lines'] = () => ({ results: [] })
    routes['/datasets/ds3'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds3',
        title: 'Long desc',
        page: 'https://example.com/datasets/ds3',
        count: 10,
        description: longDescription,
        schema: []
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds3' } })
    const sc = result.structuredContent as any

    assert.ok(sc.description.length < 3000)
    assert.ok(sc.description.endsWith('… (truncated, see dataset page for full description)'))

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Description:'))
    assert.ok(text.includes('truncated'))
  })
})

describe('search_data', () => {
  it('should search data with query and return results with filtered view URL', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('q'), 'ACME')
      assert.equal(url.searchParams.get('q_mode'), 'complete')
      assert.equal(url.searchParams.get('size'), '10')
      return {
        total: 5,
        results: [{ _id: 'abc', _i: 1, _rand: 123, nom: 'ACME', ville: 'Paris', _score: 1.5 }]
      }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.datasetId, 'ds1')
    assert.equal(content.count, 5)
    assert.equal(content.lines.length, 1)
    assert.equal(content.lines[0].nom, 'ACME')
    // Internal fields should be stripped, but _score should be kept
    assert.equal(content.lines[0]._id, undefined)
    assert.equal(content.lines[0]._i, undefined)
    assert.equal(content.lines[0]._rand, undefined)
    assert.equal(content.lines[0]._score, 1.5)
    assert.ok(content.filteredViewUrl.includes('/datasets/ds1/full'))
    assert.ok(content.filteredViewUrl.includes('q=ACME'))
  })

  it('should search data with filters', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('ville_eq'), 'Paris')
      return { total: 1, results: [{ nom: 'ACME', ville: 'Paris' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', filters: { ville_eq: 'Paris' } }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.count, 1)
  })

  it('should pass custom size parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('size'), '30')
      return { total: 50, results: [{ nom: 'ACME' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'test', size: 30 }
    })
  })

  it('should cap size at 50', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('size'), '50')
      return { total: 100, results: [{ nom: 'ACME' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'test', size: 200 }
    })
  })

  it('should return next URL when API provides one', async () => {
    routes['/datasets/ds1/lines'] = (url) => ({
      total: 25,
      results: [{ nom: 'ACME', ville: 'Paris' }],
      next: 'http://localhost/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123'
    })

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.next, 'http://localhost/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123')
  })

  it('should not include next when API does not provide one', async () => {
    routes['/datasets/ds1/lines'] = (url) => ({
      total: 1,
      results: [{ nom: 'ACME', ville: 'Paris' }]
    })

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.next, undefined)
  })

  it('should fetch directly from next URL when provided', async () => {
    const addr = fakeApi.address() as import('node:net').AddressInfo
    const nextUrl = `http://localhost:${addr.port}/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123`

    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('after'), 'abc123')
      return {
        total: 25,
        results: [{ nom: 'Globex', ville: 'Lyon' }]
      }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', next: nextUrl }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.lines[0].nom, 'Globex')
    assert.equal(content.count, 25)
  })

  it('should pass sort parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), 'population,-name')
      return { total: 2, results: [{ nom: 'A' }, { nom: 'B' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: 'population,-name' }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.count, 2)
    assert.ok(content.filteredViewUrl.includes('sort=population'))
  })

  it('should pass select parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.ok(url.searchParams.get('select')?.includes('nom'))
      return { total: 1, results: [{ nom: 'ACME' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'test', select: 'nom,ville' }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.lines.length, 1)
  })

  it('should trim spaces in select parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('select'), 'nom,ville,age')
      return { total: 1, results: [{ nom: 'ACME' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', select: 'nom, ville, age' }
    })
  })
})

describe('aggregate_data', () => {
  it('should aggregate data by columns', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('field'), 'ville')
      return {
        total: 100,
        total_values: 3,
        total_other: 10,
        aggs: [
          { value: 'Paris', total: 50, total_values: 1, total_other: 0, metric: null },
          { value: 'Lyon', total: 30, total_values: 1, total_other: 0, metric: null },
          { value: 'Marseille', total: 20, total_values: 1, total_other: 0, metric: null }
        ]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville'] }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.total, 100)
    assert.equal(content.totalAggregated, 3)
    assert.equal(content.nonRepresented, 10)
    assert.equal(content.aggregations.length, 3)
    assert.equal(content.aggregations[0].columnValue, 'Paris')
    assert.equal(content.aggregations[0].total, 50)
  })

  it('should aggregate with a metric', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'avg')
      assert.equal(url.searchParams.get('metric_field'), 'salaire')
      return {
        total: 100,
        total_values: 2,
        total_other: 0,
        aggs: [
          { value: 'Paris', total: 50, total_values: 1, total_other: 0, metric: 45000 },
          { value: 'Lyon', total: 30, total_values: 1, total_other: 0, metric: 38000 }
        ]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: {
        datasetId: 'ds1',
        groupByColumns: ['ville'],
        metric: { column: 'salaire', type: 'avg' }
      }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.aggregations[0].metricValue, 45000)
  })

  it('should support nested aggregations', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('field'), 'ville;contrat')
      return {
        total: 100,
        total_values: 2,
        total_other: 0,
        aggs: [{
          value: 'Paris',
          total: 50,
          total_values: 2,
          total_other: 0,
          metric: null,
          aggs: [
            { value: 'CDI', total: 30, total_values: 1, total_other: 0, metric: null },
            { value: 'CDD', total: 20, total_values: 1, total_other: 0, metric: null }
          ]
        }]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville', 'contrat'] }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.aggregations[0].aggregations.length, 2)
    assert.equal(content.aggregations[0].aggregations[0].columnValue, 'CDI')
  })

  it('should pass sort parameter', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('sort'), '-count')
      return { total: 10, total_values: 2, total_other: 0, aggs: [] }
    }

    await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville'], sort: '-count' }
    })
  })

  it('should not send metric params when metric is count', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), null, 'count metric should not add metric param')
      assert.equal(url.searchParams.get('metric_field'), null, 'count metric should not add metric_field param')
      return { total: 10, total_values: 2, total_other: 0, aggs: [] }
    }

    await client.callTool({
      name: 'aggregate_data',
      arguments: {
        datasetId: 'ds1',
        groupByColumns: ['ville'],
        metric: { column: 'ville', type: 'count' }
      }
    })
  })
})

describe('get_field_values', () => {
  it('should return distinct values for a column', async () => {
    routes['/datasets/ds1/values/ville'] = (url) => {
      assert.equal(url.searchParams.get('size'), '10') // default
      return ['Paris', 'Lyon', 'Marseille']
    }

    const result = await client.callTool({
      name: 'get_field_values',
      arguments: { datasetId: 'ds1', fieldKey: 'ville' }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.datasetId, 'ds1')
    assert.equal(content.fieldKey, 'ville')
    assert.deepEqual(content.values, ['Paris', 'Lyon', 'Marseille'])
  })

  it('should pass optional parameters', async () => {
    routes['/datasets/ds1/values/ville'] = (url) => {
      assert.equal(url.searchParams.get('q'), 'Ly')
      assert.equal(url.searchParams.get('sort'), 'desc')
      assert.equal(url.searchParams.get('size'), '5')
      return ['Lyon']
    }

    const result = await client.callTool({
      name: 'get_field_values',
      arguments: { datasetId: 'ds1', fieldKey: 'ville', query: 'Ly', sort: 'desc', size: 5 }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.deepEqual(content.values, ['Lyon'])
  })
})

describe('calculate_metric', () => {
  it('should calculate a metric on a column', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'avg')
      assert.equal(url.searchParams.get('field'), 'salaire')
      return { total: 1000, metric: 42500 }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'avg' }
    })
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.datasetId, 'ds1')
    assert.equal(content.fieldKey, 'salaire')
    assert.equal(content.metric, 'avg')
    assert.equal(content.total, 1000)
    assert.equal(content.value, 42500)
  })

  it('should pass filters and percents', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.ok(url.searchParams.get('percents')?.includes('25'))
      assert.equal(url.searchParams.get('ville_eq'), 'Paris')
      return { total: 500, metric: { 25: 30000, 50: 42000, 75: 55000 } }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: {
        datasetId: 'ds1',
        fieldKey: 'salaire',
        metric: 'percentiles',
        percents: '25,50,75',
        filters: { ville_eq: 'Paris' }
      }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.value['50'], 42000)
  })
})
