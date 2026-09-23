import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { buildUrl, formatResult, geocodeAddressTool } from './geocode-address.ts'

const feature = (label: string, lon: number, lat: number) => ({ properties: { label, score: 0.91, type: 'municipality', name: label, postcode: '35000', city: label, citycode: '35238', context: '35, Ille-et-Vilaine' }, geometry: { coordinates: [lon, lat] } })

describe('geocode_address', () => {
  let ign: Server
  let base: string
  const seen: URL[] = []
  before(async () => {
    ign = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x')
      seen.push(url)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ features: url.searchParams.get('q') === 'nowhere' ? [] : [feature('Rennes', -1.68, 48.11)] }))
    })
    await new Promise<void>(resolve => ign.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(ign.address() as any).port}/geocodage/search`
  })
  after(() => ign.close())

  it('builds the IGN URL, clamping the limit and refusing short queries', () => {
    assert.equal(buildUrl({ q: 'Rennes', limit: 50 }), 'https://data.geopf.fr/geocodage/search?q=Rennes&limit=20')
    assert.equal(new URL(buildUrl({ q: ' Rennes ' })).searchParams.get('limit'), '5')
    assert.throws(() => buildUrl({ q: 'ab' }), /at least 3 characters/)
  })
  it('formats results as text and structured content', () => {
    const r = formatResult({ features: [feature('Rennes', -1.68, 48.11)] }, { q: 'Rennes' })
    assert.match(r.text, /\*\*1\*\* result\(s\) for "Rennes"/)
    assert.match(r.text, /lon=-1.68, lat=48.11/)
    assert.deepEqual(r.structuredContent.results[0].citycode, '35238')
    assert.equal(formatResult({ features: [] }, { q: 'nowhere' }).text, 'No results found for "nowhere".')
  })
  it('is an openapi-mcp tool whose execute never throws', async () => {
    const tool = geocodeAddressTool({ base })
    assert.equal(tool.name, 'geocode_address')
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.deepEqual(tool.inputSchema.required, ['q'])
    const ok = await tool.execute({ q: 'Rennes', limit: 3 })
    assert.equal(ok.isError, undefined)
    assert.match(ok.text, /Rennes/)
    assert.equal(seen.at(-1)!.searchParams.get('limit'), '3')
    const short = await tool.execute({ q: 'ab' })
    assert.equal(short.isError, true)
    const down = await geocodeAddressTool({ base: 'http://127.0.0.1:1/x' }).execute({ q: 'Rennes' })
    assert.equal(down.isError, true)
    assert.match(down.text, /Geocoding API error/)
  })
})
