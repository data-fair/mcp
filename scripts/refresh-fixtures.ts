/**
 * Regenerates the data-fair fixtures of the test site from a data-fair checkout, so they follow
 * data-fair's generators instead of drifting: the merged platform API document and the
 * linked skill files. Usage: node scripts/refresh-fixtures.ts ../data-fair
 */
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const dataFair = path.resolve(process.argv[2] ?? '../data-fair')
process.env.NODE_ENV ??= 'test' // data-fair's development config needs its .env
process.env.NODE_CONFIG_DIR ??= path.join(dataFair, 'api/config')
process.env.SUPPRESS_NO_CONFIG_WARNING = '1'
const PUBLIC_URL = 'http://fixture.test/data-fair'
const fixtures = path.resolve(import.meta.dirname, '../test/fixtures')

const apiDocs = (await import(path.join(dataFair, 'api/contract/api-docs.ts'))).default
const { prepareFragment, mergePlatformDoc } = await import(path.join(dataFair, 'api/contract/platform-api-docs.ts'))

const write = (file: string, value: unknown) => writeFileSync(path.join(fixtures, file), JSON.stringify(value, null, 2) + '\n')
const service = { id: 'datafair', title: 'Data Fair', mountPath: '/data-fair/api/v1', docPath: '/data-fair/api/v1/api-docs.json' }
const prepared = prepareFragment(service, apiDocs(PUBLIC_URL))
if ('refused' in prepared) throw new Error('data-fair document refused: ' + JSON.stringify(prepared.refused))
const states = [{ service, fragment: prepared.fragment, status: 'ok', fetchedAt: new Date().toISOString() }]
write('platform-api-docs.json', mergePlatformDoc('http://fixture.test', states, { version: 'fixture', oauth2Description: 'Platform scopes' }))

const skills = path.join(fixtures, 'data-fair-skills')
rmSync(skills, { recursive: true, force: true })
mkdirSync(skills)
const source = path.join(dataFair, 'api/contract/agent-skills')
for (const file of readdirSync(source).filter(f => f.endsWith('.md'))) copyFileSync(path.join(source, file), path.join(skills, file))
console.log(`fixtures refreshed from ${dataFair}`)
process.exit(0)
