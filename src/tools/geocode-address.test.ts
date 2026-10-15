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
      const q = url.searchParams.get('q')
      if (q === 'error') {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Internal Server Error')
      } else if (q === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ features: [{ properties: {} }] }))
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ features: q === 'nowhere' ? [] : [feature('Rennes', -1.68, 48.11)] }))
      }
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
    const failed = await tool.execute({ q: 'error' })
    assert.equal(failed.isError, true)
    assert.match(failed.text, /Geocoding API error: HTTP 500/)
    const broken = await tool.execute({ q: 'malformed' })
    assert.equal(broken.isError, true)
    assert.match(broken.text, /Geocoding API error/)
  })
  it('refuses a caller over its own budget, while another caller still gets through', async () => {
    const tool = geocodeAddressTool({ base, limits: { global: { nb: 100, duration: 60 }, perCaller: { nb: 1, duration: 60 } } })
    const alice = { identity: 'alice' }
    assert.equal((await tool.execute({ q: 'Rennes' }, alice)).isError, undefined)
    const refused = await tool.execute({ q: 'Rennes' }, alice)
    assert.equal(refused.isError, true)
    assert.match(refused.text, /busy.*retry/i)
    assert.equal((await tool.execute({ q: 'Rennes' }, { identity: 'bob' })).isError, undefined)
  })
  it('refuses everyone once the global budget is spent', async () => {
    const tool = geocodeAddressTool({ base, limits: { global: { nb: 1, duration: 60 }, perCaller: { nb: 100, duration: 60 } } })
    assert.equal((await tool.execute({ q: 'Rennes' }, { identity: 'alice' })).isError, undefined)
    assert.equal((await tool.execute({ q: 'Rennes' }, { identity: 'bob' })).isError, true)
  })
  it('accounts an anonymous caller to its forwarded IP, an IPv6 one to its /64', async () => {
    const tool = geocodeAddressTool({ base, limits: { global: { nb: 100, duration: 60 }, perCaller: { nb: 1, duration: 60 } } })
    const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } })
    assert.equal((await tool.execute({ q: 'Rennes' }, from('203.0.113.7'))).isError, undefined)
    assert.equal((await tool.execute({ q: 'Rennes' }, from('203.0.113.7'))).isError, true)
    assert.equal((await tool.execute({ q: 'Rennes' }, from('203.0.113.8'))).isError, undefined)
    assert.equal((await tool.execute({ q: 'Rennes' }, from('2001:db8:1:2::1'))).isError, undefined)
    assert.equal((await tool.execute({ q: 'Rennes' }, from('2001:db8:1:2::2'))).isError, true, 'the same /64')
  })
  it('refuses a call with no caller to account it to, without calling IGN', async () => {
    const before = seen.length
    const tool = geocodeAddressTool({ base, limits: { global: { nb: 100, duration: 60 }, perCaller: { nb: 100, duration: 60 } } })
    const refused = await tool.execute({ q: 'Rennes' }, {})
    assert.equal(refused.isError, true)
    assert.match(refused.text, /no caller/)
    assert.doesNotMatch(refused.text, /retry/)
    assert.equal(seen.length, before)
  })
})
