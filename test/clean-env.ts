// Loaded before every test file (--import): the tests assume the config files only, so the variables
// that config/custom-environment-variables.cjs maps are removed from the environment a shell or a dev
// stack may have set. Children spawned by the tests inherit the cleaned environment.
import { createRequire } from 'node:module'

const mapping = createRequire(import.meta.url)('../config/custom-environment-variables.cjs')

const names = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (!node || typeof node !== 'object') return []
  if ('__name' in node) return [String((node as { __name: string }).__name)]
  return Object.values(node).flatMap(names)
}

for (const name of names(mapping)) delete process.env[name]
