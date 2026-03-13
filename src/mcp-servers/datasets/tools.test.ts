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
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.count, 2)
    assert.equal(content.datasets.length, 2)
    assert.equal(content.datasets[0].id, 'ds1')
    assert.equal(content.datasets[0].title, 'Entreprises')
    assert.equal(content.datasets[0].summary, 'Liste des entreprises')
    assert.equal(content.datasets[0].link, 'https://example.com/datasets/ds1')
    // Dataset without summary should not include the field
    assert.equal(content.datasets[1].summary, undefined)
  })
})

describe('describe_dataset', () => {
  it('should return dataset metadata with schema and sample lines', async () => {
    routes['/datasets/ds1/lines'] = () => ({
      results: [
        { nom: 'ACME', ville: 'Paris' },
        { nom: 'Globex', ville: 'Lyon' },
        { nom: 'Initech', ville: 'Paris' }
      ]
    })
    routes['/datasets/ds1'] = (url) => {
      // Only match the metadata endpoint, not /lines
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
    const content = JSON.parse((result.content as any)[0].text)

    assert.equal(content.id, 'ds1')
    assert.equal(content.title, 'Entreprises')
    assert.equal(content.slug, 'entreprises')
    assert.equal(content.count, 1000)
    assert.equal(content.license.title, 'Open License')

    // Internal columns (_id, _i, _rand) should be filtered out
    assert.equal(content.schema.length, 2)
    assert.equal(content.schema[0].key, 'nom')
    assert.equal(content.schema[0].concept, 'Nom entreprise')
    assert.equal(content.schema[1].key, 'ville')
    assert.deepEqual(content.schema[1].enum, ['Paris', 'Lyon'])
    assert.deepEqual(content.schema[1].labels, { Paris: 'Paris', Lyon: 'Lyon' })

    // Sample lines
    assert.equal(content.sampleLines.length, 3)
    assert.equal(content.sampleLines[0].nom, 'ACME')
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
        results: [{ nom: 'ACME', ville: 'Paris', _score: 1.5 }]
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
      arguments: { datasetId: 'ds1', aggregationColumns: ['ville'] }
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
        aggregationColumns: ['ville'],
        aggregation: { column: 'salaire', metric: 'avg' }
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
      arguments: { datasetId: 'ds1', aggregationColumns: ['ville', 'contrat'] }
    })
    const content = JSON.parse((result.content as any)[0].text)
    assert.equal(content.aggregations[0].aggregations.length, 2)
    assert.equal(content.aggregations[0].aggregations[0].columnValue, 'CDI')
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
        aggregationColumns: ['ville'],
        aggregation: { column: 'ville', metric: 'count' }
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
