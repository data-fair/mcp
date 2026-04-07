import { describe, it, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import nock from 'nock'
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

describe('list_datasets', () => {
  it('should list datasets and return formatted results', async () => {
    routes['/catalog/datasets'] = (url) => ({
      count: 2,
      results: [
        { id: 'ds1', title: 'Entreprises', summary: 'Liste des entreprises', page: 'https://example.com/datasets/ds1' },
        { id: 'ds2', title: 'Logements', page: 'https://example.com/datasets/ds2' }
      ]
    })

    const result = await client.callTool({ name: 'list_datasets', arguments: { q: 'entreprises' } })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.count, 2)
    assert.equal(sc.results.length, 2)
    assert.equal(sc.results[0].id, 'ds1')
    assert.equal(sc.results[0].title, 'Entreprises')
    assert.equal(sc.results[0].summary, 'Liste des entreprises')
    assert.equal(sc.results[0].page, 'https://example.com/datasets/ds1')
    assert.equal(sc.results[1].summary, undefined)

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('**2** datasets found'))
    assert.ok(text.includes('**Entreprises**'))
    assert.ok(text.includes('ds1'))
    assert.ok(text.includes('**Logements**'))
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
    assert.ok(text.includes('# Entreprises'))
    assert.ok(text.includes('**ID:**'))
    assert.ok(text.includes('**Rows:** 1000'))
    assert.ok(text.includes('**License:** Open License'))
    assert.ok(text.includes('**Keywords:** entreprise, siège'))
    assert.ok(text.includes('nom'))
    assert.ok(text.includes('labels: Paris=Paris, Lyon=Lyon'))
    assert.ok(text.includes('## Sample data'))
    assert.ok(text.includes('nom,ville'))
    assert.ok(text.includes('ACME,Paris'))
    assert.ok(!text.startsWith('{'))  // No JSON
  })

  it('should detect geolocalized dataset with bbox', async () => {
    routes['/datasets/geo1/lines'] = () => ({
      results: [{ _id: 'a', _i: 1, _rand: 1, nom: 'Mairie', lat: 48.85, lon: 2.35 }]
    })
    routes['/datasets/geo1'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'geo1',
        title: 'Points géo',
        page: 'https://example.com/datasets/geo1',
        count: 500,
        bbox: [-5.14, 41.33, 9.56, 51.09],
        schema: [
          { key: 'nom', type: 'string', title: 'Nom' },
          { key: 'lat', type: 'number' },
          { key: 'lon', type: 'number' }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'geo1' } })
    const sc = result.structuredContent as any

    assert.equal(sc.geolocalized, true)
    assert.deepEqual(sc.bbox, [-5.14, 41.33, 9.56, 51.09])

    const text = (result.content as any)[0].text
    assert.ok(text.includes('**Geolocalized:** yes'))
    assert.ok(text.includes('bbox:'))
    assert.ok(text.includes('Geo filters'))
  })

  it('should not set geolocalized for non-geo dataset', async () => {
    routes['/datasets/nongeo/lines'] = () => ({ results: [{ nom: 'test' }] })
    routes['/datasets/nongeo'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'nongeo',
        title: 'Non geo',
        page: 'https://example.com/datasets/nongeo',
        count: 10,
        schema: [{ key: 'nom', type: 'string' }]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'nongeo' } })
    const sc = result.structuredContent as any

    assert.equal(sc.geolocalized, undefined)
    assert.equal(sc.bbox, undefined)

    const text = (result.content as any)[0].text
    assert.ok(!text.includes('Geolocalized'))
  })

  it('should detect temporal dataset with timePeriod', async () => {
    routes['/datasets/temporal1/lines'] = () => ({
      results: [{ _id: 'a', _i: 1, _rand: 1, date: '2023-06-15' }]
    })
    routes['/datasets/temporal1'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'temporal1',
        title: 'Données temporelles',
        page: 'https://example.com/datasets/temporal1',
        count: 200,
        timePeriod: { startDate: '2023-01-01T00:00:00.000Z', endDate: '2023-12-31T23:59:59.999Z' },
        schema: [
          { key: 'date', type: 'string', 'x-refersTo': 'http://schema.org/Date' }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'temporal1' } })
    const sc = result.structuredContent as any

    assert.equal(sc.temporalDataset, true)
    assert.deepEqual(sc.timePeriod, { startDate: '2023-01-01T00:00:00.000Z', endDate: '2023-12-31T23:59:59.999Z' })

    const text = (result.content as any)[0].text
    assert.ok(text.includes('**Temporal dataset:** yes'))
    assert.ok(text.includes('dateMatch'))
  })

  it('should not set temporalDataset for non-temporal dataset', async () => {
    routes['/datasets/nontemporal/lines'] = () => ({ results: [{ nom: 'test' }] })
    routes['/datasets/nontemporal'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'nontemporal',
        title: 'Non temporal',
        page: 'https://example.com/datasets/nontemporal',
        count: 10,
        schema: [{ key: 'nom', type: 'string' }]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'nontemporal' } })
    const sc = result.structuredContent as any

    assert.equal(sc.temporalDataset, undefined)
    assert.equal(sc.timePeriod, undefined)

    const text = (result.content as any)[0].text
    assert.ok(!text.includes('Temporal dataset'))
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
    assert.ok(text.includes('**Description:**'))
    assert.ok(text.includes('…'))
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

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.total, 5)
    assert.equal(sc.results.length, 1)
    assert.equal(sc.results[0].nom, 'ACME')
    assert.equal(sc.results[0]._id, undefined)
    assert.equal(sc.results[0]._i, undefined)
    assert.equal(sc.results[0]._rand, undefined)
    assert.equal(sc.results[0]._score, 1.5)
    assert.ok(sc.filteredViewUrl.includes('/datasets/ds1/full'))
    assert.ok(sc.filteredViewUrl.includes('q=ACME'))

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('**5** rows found'))
    assert.ok(text.includes('ACME,Paris'))
    assert.ok(text.includes('nom,ville,_score'))  // _score column present when query used
    assert.ok(!text.startsWith('{'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.total, 1)

    // When no query is used, _score should not appear in text
    const text = (result.content as any)[0].text
    assert.ok(!text.includes('_score'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.next, 'http://localhost/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123')

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Next page available.'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.next, undefined)

    const text = (result.content as any)[0].text
    assert.ok(!text.includes('Next page available.'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.results[0].nom, 'Globex')
    assert.equal(sc.total, 25)
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
    const sc = result.structuredContent as any
    assert.equal(sc.total, 2)
    assert.ok(sc.filteredViewUrl.includes('sort=population'))
  })

  it('should drop incomplete _geo_distance sort without coordinates', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), null)
      return { total: 1, results: [{ nom: 'A' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: '_geo_distance', geoDistance: '2.35,48.85,10km' }
    })
  })

  it('should drop incomplete -_geo_distance sort without coordinates', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), null)
      return { total: 1, results: [{ nom: 'A' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: '-_geo_distance' }
    })
  })

  it('should drop incomplete _geo_distance in mixed sort fields', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), 'population')
      return { total: 1, results: [{ nom: 'A' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: 'population,-_geo_distance', geoDistance: '2.35,48.85,5km' }
    })
  })

  it('should pass through already-complete _geo_distance:lon:lat sort', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), '_geo_distance:2.35:48.85')
      return { total: 1, results: [{ nom: 'A' }] }
    }

    await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: '_geo_distance:2.35:48.85' }
    })
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
    const sc = result.structuredContent as any
    assert.equal(sc.results.length, 1)
  })

  it('should pass bbox parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('bbox'), '-2.5,43,3,47')
      return { total: 3, results: [{ nom: 'ACME', ville: 'Toulouse' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', bbox: '-2.5,43,3,47' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.total, 3)
    assert.ok(sc.filteredViewUrl.includes('bbox=-2.5'))
  })

  it('should pass geoDistance parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('geo_distance'), '2.35,48.85,10km')
      return { total: 5, results: [{ nom: 'ACME', ville: 'Paris' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', geoDistance: '2.35,48.85,10km' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.total, 5)
    assert.ok(sc.filteredViewUrl.includes('geo_distance='))
  })

  it('should pass dateMatch parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('date_match'), '2023-11-21')
      return { total: 2, results: [{ nom: 'ACME', ville: 'Paris' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', dateMatch: '2023-11-21' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.total, 2)
    assert.ok(sc.filteredViewUrl.includes('date_match='))
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
    const sc = result.structuredContent as any

    assert.equal(sc.total, 100)
    assert.equal(sc.total_values, 3)
    assert.equal(sc.total_other, 10)
    assert.equal(sc.aggs.length, 3)
    assert.equal(sc.aggs[0].value, 'Paris')
    assert.equal(sc.aggs[0].total, 50)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('**100** total rows'))
    assert.ok(text.includes('**3** groups shown'))
    assert.ok(text.includes('**10** rows not represented'))
    assert.ok(text.includes('- **Paris**: 50 rows'))
    assert.ok(text.includes('- **Lyon**: 30 rows'))
    assert.ok(!text.startsWith('{'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.aggs[0].metric, 45000)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('- **Paris**: 50 rows, avg(salaire) = 45000'))
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
    const sc = result.structuredContent as any
    assert.equal(sc.aggs[0].aggs.length, 2)
    assert.equal(sc.aggs[0].aggs[0].value, 'CDI')

    const text = (result.content as any)[0].text
    assert.ok(text.includes('- **Paris**: 50 rows'))
    assert.ok(text.includes('  - **CDI**: 30 rows'))
    assert.ok(text.includes('  - **CDD**: 20 rows'))
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

  it('should pass bbox and geoDistance parameters', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('bbox'), '1,42,4,46')
      assert.equal(url.searchParams.get('geo_distance'), '2.35,48.85,5km')
      return { total: 10, total_values: 2, total_other: 0, aggs: [] }
    }

    await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville'], bbox: '1,42,4,46', geoDistance: '2.35,48.85,5km' }
    })
  })

  it('should pass dateMatch parameter', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('date_match'), '2023-01-01,2023-12-31')
      return { total: 10, total_values: 2, total_other: 0, aggs: [] }
    }

    await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville'], dateMatch: '2023-01-01,2023-12-31' }
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
      assert.equal(url.searchParams.get('size'), '10')
      return ['Paris', 'Lyon', 'Marseille']
    }

    const result = await client.callTool({
      name: 'get_field_values',
      arguments: { datasetId: 'ds1', fieldKey: 'ville' }
    })
    const sc = result.structuredContent as any

    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.fieldKey, 'ville')
    assert.deepEqual(sc.values, ['Paris', 'Lyon', 'Marseille'])

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Distinct values of `ville`'))
    assert.ok(text.includes('Paris'))
    assert.ok(text.includes('Lyon'))
    assert.ok(text.includes('Marseille'))
    assert.ok(!text.startsWith('{'))
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
    const sc = result.structuredContent as any
    assert.deepEqual(sc.values, ['Lyon'])
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
    const sc = result.structuredContent as any

    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.fieldKey, 'salaire')
    assert.equal(sc.total, 1000)
    assert.equal(sc.metric, 42500)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('**avg** of `salaire`'))
    assert.ok(text.includes('Total rows: 1000'))
    assert.ok(text.includes('Result: **42500**'))
    assert.ok(!text.startsWith('{'))
  })

  it('should format stats metric as key=value pairs', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'stats')
      return { total: 1000, metric: { count: 1000, min: 18000, max: 120000, avg: 48500, sum: 48500000 } }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'stats' }
    })
    const text = (result.content as any)[0].text
    assert.ok(text.includes('count: 1000'))
    assert.ok(text.includes('min: 18000'))
    assert.ok(text.includes('avg: 48500'))
  })

  it('should pass bbox and geoDistance parameters', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('bbox'), '-1,43,3,47')
      assert.equal(url.searchParams.get('geo_distance'), '2.35,48.85,20km')
      return { total: 200, metric: 35000 }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'avg', bbox: '-1,43,3,47', geoDistance: '2.35,48.85,20km' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.metric, 35000)
  })

  it('should pass dateMatch parameter', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('date_match'), '2023-06-15')
      return { total: 100, metric: 42000 }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'avg', dateMatch: '2023-06-15' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.metric, 42000)
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
    const sc = result.structuredContent as any
    assert.equal(sc.metric['50'], 42000)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('p25: 30000'))
    assert.ok(text.includes('p50: 42000'))
  })
})

describe('geocode_address', () => {
  afterEach(() => {
    nock.cleanAll()
  })

  it('should geocode an address and return structured results', async () => {
    nock('https://data.geopf.fr')
      .get('/geocodage/search')
      .query({ q: '20 avenue de segur paris', limit: '5' })
      .reply(200, {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [2.308628, 48.850699] },
            properties: {
              label: '20 Avenue de Ségur 75007 Paris',
              score: 0.9716454545454545,
              housenumber: '20',
              id: '75107_8909_00020',
              name: '20 Avenue de Ségur',
              postcode: '75007',
              citycode: '75107',
              x: 649266.35,
              y: 6861406.23,
              city: 'Paris',
              district: 'Paris 7e Arrondissement',
              context: '75, Paris, Île-de-France',
              type: 'housenumber',
              importance: 0.6881,
              street: 'Avenue de Ségur',
              _type: 'address'
            }
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [2.305575, 48.847446] },
            properties: {
              label: 'Avenue de Ségur 75015 Paris',
              score: 0.7738569960474307,
              id: '75115_8909',
              name: 'Avenue de Ségur',
              postcode: '75015',
              citycode: '75115',
              x: 649039.14,
              y: 6861046.5,
              city: 'Paris',
              district: 'Paris 15e Arrondissement',
              context: '75, Paris, Île-de-France',
              type: 'street',
              importance: 0.68634,
              street: 'Avenue de Ségur',
              _type: 'address'
            }
          }
        ],
        query: '20 avenue de segur paris'
      })

    const result = await client.callTool({ name: 'geocode_address', arguments: { q: '20 avenue de segur paris' } })

    const sc = result.structuredContent as any
    assert.equal(sc.count, 2)
    assert.equal(sc.results.length, 2)
    assert.equal(sc.results[0].label, '20 Avenue de Ségur 75007 Paris')
    assert.equal(sc.results[0].score, 0.9716454545454545)
    assert.equal(sc.results[0].type, 'housenumber')
    assert.equal(sc.results[0].postcode, '75007')
    assert.equal(sc.results[0].city, 'Paris')
    assert.equal(sc.results[0].citycode, '75107')
    assert.equal(sc.results[0].longitude, 2.308628)
    assert.equal(sc.results[0].latitude, 48.850699)
    assert.equal(sc.results[0].context, '75, Paris, Île-de-France')
    assert.equal(sc.results[1].label, 'Avenue de Ségur 75015 Paris')
    assert.equal(sc.results[1].type, 'street')

    const text = (result.content as any)[0].text
    assert.ok(text.includes('**2** result(s)'))
    assert.ok(text.includes('20 Avenue de Ségur 75007 Paris'))
    assert.ok(text.includes('Coordinates: 48.850699, 2.308628'))
    assert.ok(text.includes('Île-de-France'))
    assert.ok(!text.startsWith('{'))
  })

  it('should return empty results when no features match', async () => {
    nock('https://data.geopf.fr')
      .get('/geocodage/search')
      .query({ q: 'zzzznotanaddress', limit: '5' })
      .reply(200, {
        type: 'FeatureCollection',
        features: [],
        query: 'zzzznotanaddress'
      })

    const result = await client.callTool({ name: 'geocode_address', arguments: { q: 'zzzznotanaddress' } })

    const sc = result.structuredContent as any
    assert.equal(sc.count, 0)
    assert.equal(sc.results.length, 0)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('No results found'))
  })

  it('should pass custom limit parameter', async () => {
    nock('https://data.geopf.fr')
      .get('/geocodage/search')
      .query({ q: 'rue de rivoli', limit: '3' })
      .reply(200, {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [3.092229, 50.635903] },
            properties: {
              label: 'Rue de Rivoli 59800 Lille',
              score: 0.9815381818181819,
              id: '59350_7519',
              banId: '1170800a-13da-4140-befb-eedc6d9cdf79',
              name: 'Rue de Rivoli',
              postcode: '59800',
              citycode: '59350',
              x: 706535.87,
              y: 7059885.84,
              city: 'Lille',
              context: '59, Nord, Hauts-de-France',
              type: 'street',
              importance: 0.79692,
              street: 'Rue de Rivoli',
              _type: 'address'
            }
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [7.258613, 43.696415] },
            properties: {
              label: 'Rue de Rivoli 06000 Nice',
              score: 0.9762209090909091,
              id: '06088_5495',
              banId: '09b12796-4147-4ce0-b8b3-73b8ec1158ec',
              name: 'Rue de Rivoli',
              postcode: '06000',
              citycode: '06088',
              x: 1043220.1,
              y: 6297855.58,
              city: 'Nice',
              context: '06, Alpes-Maritimes, Provence-Alpes-Côte d\'Azur',
              type: 'street',
              importance: 0.73843,
              street: 'Rue de Rivoli',
              _type: 'address'
            }
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0.148337, 49.49961] },
            properties: {
              label: 'Rue de Rivoli 76600 Le Havre',
              score: 0.9755127272727272,
              id: '76351_6965',
              banId: '837ecb39-670b-4c96-9025-46bca65f035f',
              name: 'Rue de Rivoli',
              postcode: '76600',
              citycode: '76351',
              x: 493390.68,
              y: 6937093.24,
              city: 'Le Havre',
              context: '76, Seine-Maritime, Normandie',
              type: 'street',
              importance: 0.73064,
              street: 'Rue de Rivoli',
              _type: 'address'
            }
          }
        ],
        query: 'rue de rivoli'
      })

    const result = await client.callTool({ name: 'geocode_address', arguments: { q: 'rue de rivoli', limit: 3 } })

    const sc = result.structuredContent as any
    assert.equal(sc.count, 3)
    assert.equal(sc.results[0].type, 'street')
    assert.equal(sc.results[0].city, 'Lille')
    assert.equal(sc.results[1].city, 'Nice')
    assert.equal(sc.results[2].city, 'Le Havre')
  })
})
