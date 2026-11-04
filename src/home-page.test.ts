import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { homePage, homePageCsp, negotiateLocale } from './home-page.ts'

const hashOf = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

describe('home page', () => {
  it('picks fr or en by quality, else the configured locale', () => {
    assert.equal(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8', 'en'), 'fr')
    assert.equal(negotiateLocale('de;q=1, en;q=0.5, fr;q=0.4', 'fr'), 'en')
    assert.equal(negotiateLocale('fr;q=0, en;q=0.1', 'fr'), 'en')
    assert.equal(negotiateLocale('de', 'fr'), 'fr')
    assert.equal(negotiateLocale(undefined, 'en'), 'en')
    assert.equal(negotiateLocale(undefined, 'it'), 'en')
  })
  it('allows exactly its inline style and script', () => {
    const html = homePage({ serverUrl: 'https://portal.test/mcp-server', oauth: true, locale: 'en', version: '1.0.0' })
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1]
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
    assert.ok(homePageCsp.includes(`style-src ${hashOf(style)}`), homePageCsp)
    assert.ok(homePageCsp.includes(`script-src ${hashOf(script)}`), homePageCsp)
    assert.match(homePageCsp, /default-src 'none'/)
    assert.doesNotMatch(homePageCsp, /unsafe/)
  })
  it('escapes what it prints', () => {
    const html = homePage({ serverUrl: 'https://portal.test/<b>"x/mcp-server', oauth: false, locale: 'fr', version: '<1>' })
    assert.doesNotMatch(html, /<b>|"x/)
    assert.match(html, /&lt;b&gt;&quot;x/)
    assert.match(html, /&lt;1&gt;/)
  })
})
