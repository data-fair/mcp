/**
 * The home page of /mcp-server/: what a person needs to connect an MCP client on this site, the
 * two servers' URLs, how the platform server authenticates here (OAuth on issuer sites, an API
 * key everywhere), client configuration examples. Plain HTML, no asset: the inline style and script
 * (copy buttons) are allowed by their hashes, every value from the request is escaped.
 */
import { createHash } from 'node:crypto'

export type HomeLocale = 'fr' | 'en'

const COPY_SCRIPT = `document.querySelectorAll('button[data-copy]').forEach(b => b.addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent).then(() => {
    const label = b.textContent; b.textContent = b.dataset.done; setTimeout(() => { b.textContent = label }, 1500)
  })
}))`

const STYLE = `:root { color-scheme: light dark; --fg: #1d1d1f; --muted: #5c5c66; --bg: #fff; --box: #f3f4f6; --line: #d8dae0; --accent: #1565c0; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --muted: #a4a4b0; --bg: #16171b; --box: #23252b; --line: #3a3d45; --accent: #64a8f0; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; } h1 small { display: block; font-size: .95rem; font-weight: normal; color: var(--muted); }
h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; } h3 { font-size: 1rem; margin: 1.25rem 0 .4rem; }
p, li { color: var(--fg); } .muted { color: var(--muted); }
section.server { border: 1px solid var(--line); border-radius: 8px; padding: .25rem 1rem .75rem; margin: 1rem 0; }
.copy { display: flex; gap: .5rem; align-items: flex-start; margin: .4rem 0; }
.copy code, .copy pre { flex: 1; margin: 0; padding: .45rem .6rem; background: var(--box); border-radius: 6px; font: .9rem/1.45 ui-monospace, monospace; overflow-x: auto; white-space: pre; }
button { font: inherit; font-size: .85rem; padding: .4rem .7rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
.copy code { white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: var(--accent); }
`

const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

export const homePageCsp = `default-src 'none'; style-src ${hash(STYLE)}; script-src ${hash(COPY_SCRIPT)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** fr or en from Accept-Language, by quality; the configured locale when neither is asked for */
export function negotiateLocale (acceptLanguage: string | undefined, fallback: string): HomeLocale {
  const asked = (acceptLanguage ?? '').split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';')
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='))
    return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i }
  }).filter(a => a.q > 0 && (a.lang === 'fr' || a.lang === 'en')).sort((a, b) => b.q - a.q || a.i - b.i)
  return (asked[0]?.lang as HomeLocale | undefined) ?? (fallback === 'fr' ? 'fr' : 'en')
}

const messages = {
  en: {
    title: 'MCP servers',
    intro: 'This site offers two servers of the Model Context Protocol (MCP), to connect AI assistants and agents (Claude, ChatGPT, IDE agents…) to Data Fair. Add one of these URLs to your MCP client as a remote server (streamable HTTP).',
    copy: 'Copy',
    copied: 'Copied',
    platformTitle: 'Platform server',
    platformDesc: 'Works with the platform as an authenticated identity: datasets, applications, portals and the other resources its permissions allow. Its tools are the ones its credentials grant.',
    datasetsTitle: 'Datasets server',
    datasetsDesc: 'Explores the data published on this site: find datasets, read their schema, search, aggregate and compute metrics. Usable anonymously; with credentials it also reaches the datasets they may read.',
    authTitle: 'Authentication of the platform server',
    oauthTitle: 'OAuth login',
    oauthSteps: [
      'Add the URL to your MCP client: it opens a login page of this site.',
      'An administrator of an organization logs in and picks the machine identity (NHI) of the organization the client will act as, and how long the access lasts.',
      'The client then works with the permissions and scopes of that identity, and renews its access by itself until it expires or is revoked.'
    ],
    oauthPrereqs: 'Prerequisites: being an administrator of the organization, which must already have a machine identity (created on the organization page, never at login). The identity\'s scopes cap the tools the client gets.',
    noOauth: 'This site offers no OAuth login: connect with an API key.',
    apiKeyTitle: 'API key',
    apiKey: 'Send an API key of your account or organization in the x-apiKey header.',
    examplesTitle: 'Examples',
    claudeOauth: 'Claude Code, OAuth login:',
    claudeApiKey: 'Claude Code, API key:',
    json: 'Clients configured by a JSON file:',
    catalog: 'Machine-readable description of these servers:'
  },
  fr: {
    title: 'Serveurs MCP',
    intro: 'Ce site propose deux serveurs du Model Context Protocol (MCP), pour connecter des assistants et agents d\'IA (Claude, ChatGPT, agents d\'IDE…) à Data Fair. Ajoutez une de ces URL à votre client MCP comme serveur distant (streamable HTTP).',
    copy: 'Copier',
    copied: 'Copié',
    platformTitle: 'Serveur de la plateforme',
    platformDesc: 'Travaille avec la plateforme sous une identité authentifiée : jeux de données, applications, portails et autres ressources que ses permissions autorisent. Ses outils sont ceux que ses accès accordent.',
    datasetsTitle: 'Serveur des jeux de données',
    datasetsDesc: 'Explore les données publiées sur ce site : trouver des jeux de données, lire leur schéma, rechercher, agréger et calculer des métriques. Utilisable anonymement ; avec des accès il atteint aussi les jeux de données qu\'ils permettent de lire.',
    authTitle: 'Authentification du serveur de la plateforme',
    oauthTitle: 'Connexion OAuth',
    oauthSteps: [
      'Ajoutez l\'URL à votre client MCP : il ouvre une page de connexion de ce site.',
      'Un administrateur d\'une organisation se connecte et choisit l\'identité machine (NHI) de l\'organisation pour laquelle le client agira, et la durée de l\'accès.',
      'Le client travaille alors avec les permissions et les scopes de cette identité, et renouvelle son accès seul jusqu\'à son expiration ou sa révocation.'
    ],
    oauthPrereqs: 'Prérequis : être administrateur de l\'organisation, qui doit déjà avoir une identité machine (créée sur la page de l\'organisation, jamais à la connexion). Les scopes de l\'identité limitent les outils que le client obtient.',
    noOauth: 'Ce site ne propose pas de connexion OAuth : connectez-vous avec une clé d\'API.',
    apiKeyTitle: 'Clé d\'API',
    apiKey: 'Envoyez une clé d\'API de votre compte ou de votre organisation dans l\'en-tête x-apiKey.',
    examplesTitle: 'Exemples',
    claudeOauth: 'Claude Code, connexion OAuth :',
    claudeApiKey: 'Claude Code, clé d\'API :',
    json: 'Clients configurés par un fichier JSON :',
    catalog: 'Description de ces serveurs lisible par les machines :'
  }
}

export function homePage (options: { serverUrl: string, oauth: boolean, locale: HomeLocale, version: string }): string {
  const { serverUrl, oauth, locale, version } = options
  const t = messages[locale]
  const platformUrl = serverUrl + '/mcp'
  const datasetsUrl = serverUrl + '/datasets/mcp'
  const host = new URL(serverUrl).host
  let ids = 0
  const copyable = (text: string, tag: 'code' | 'pre' = 'code') => {
    const id = `c${++ids}`
    return `<div class="copy"><${tag} id="${id}">${escape(text)}</${tag}><button type="button" data-copy="${id}" data-done="${escape(t.copied)}">${escape(t.copy)}</button></div>`
  }
  const json = JSON.stringify({ mcpServers: { datafair: { type: 'http', url: platformUrl } } }, null, 2)
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(t.title)} — ${escape(host)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escape(t.title)}<small>${escape(host)}</small></h1>
<p>${escape(t.intro)}</p>

<section class="server">
<h2>${escape(t.platformTitle)}</h2>
${copyable(platformUrl)}
<p>${escape(t.platformDesc)}</p>
</section>

<section class="server">
<h2>${escape(t.datasetsTitle)}</h2>
${copyable(datasetsUrl)}
<p>${escape(t.datasetsDesc)}</p>
</section>

<h2>${escape(t.authTitle)}</h2>
${oauth
  ? `<h3>${escape(t.oauthTitle)}</h3>
<ol>${t.oauthSteps.map(s => `<li>${escape(s)}</li>`).join('')}</ol>
<p class="muted">${escape(t.oauthPrereqs)}</p>`
  : `<p>${escape(t.noOauth)}</p>`}
<h3>${escape(t.apiKeyTitle)}</h3>
<p>${escape(t.apiKey)}</p>

<h2>${escape(t.examplesTitle)}</h2>
${oauth ? `<p>${escape(t.claudeOauth)}</p>${copyable(`claude mcp add --transport http datafair ${platformUrl}`)}` : ''}
<p>${escape(t.claudeApiKey)}</p>
${copyable(`claude mcp add --transport http datafair ${platformUrl} --header "x-apiKey: <API key>"`)}
<p>${escape(t.json)}</p>
${copyable(json, 'pre')}

<p class="muted">${escape(t.catalog)} <a href="${escape(serverUrl)}/ai-catalog.json">ai-catalog.json</a> · @data-fair/mcp ${escape(version)}</p>
</main>
<script>${COPY_SCRIPT}</script>
</body>
</html>
`
}
