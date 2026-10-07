/**
 * Regenerates the data-fair fixtures of the test site from a data-fair checkout, so they follow
 * data-fair's generators instead of drifting: the root API document, the agents index and the
 * linked skill files. Usage: node scripts/refresh-fixtures.ts ../data-fair
 */
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const dataFair = path.resolve(process.argv[2] ?? '../data-fair')
process.env.NODE_CONFIG_DIR ??= path.join(dataFair, 'api/config')
process.env.SUPPRESS_NO_CONFIG_WARNING = '1'
const PUBLIC_URL = 'http://fixture.test/data-fair'
const fixtures = path.resolve(import.meta.dirname, '../test/fixtures')

const apiDocs = (await import(path.join(dataFair, 'api/contract/api-docs.ts'))).default
const { agentsIndex } = await import(path.join(dataFair, 'api/contract/agents-index.ts'))

const write = (file: string, value: unknown) => writeFileSync(path.join(fixtures, file), JSON.stringify(value, null, 2) + '\n')
write('data-fair-api-docs.json', apiDocs(PUBLIC_URL))
write('data-fair-agents-index.json', agentsIndex(PUBLIC_URL, { publicUrl: PUBLIC_URL }))

const skills = path.join(fixtures, 'data-fair-skills')
rmSync(skills, { recursive: true, force: true })
mkdirSync(skills)
const source = path.join(dataFair, 'api/contract/agent-skills')
for (const file of readdirSync(source).filter(f => f.endsWith('.md'))) copyFileSync(path.join(source, file), path.join(skills, file))
console.log(`fixtures refreshed from ${dataFair}`)
process.exit(0)
