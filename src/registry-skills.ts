import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Skill, SkillResource } from '@data-fair/openapi-mcp'

export const SKILL_LIMITS = { fileSize: 256 * 1024, total: 2 * 1024 * 1024, files: 100 }

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.csv': 'text/csv',
  '.txt': 'text/plain'
}

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024

const utf8 = new TextDecoder('utf-8', { fatal: true })

const extensionOf = (path: string) => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

const isSafePath = (path: string) => !path.startsWith('/') && !path.split('/').some(s => s === '..' || s === '')

// a served file name stays a plain, portable uri segment
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

type Entry = { path: string, size: number }

/** Walks dir without following symlinks; returns the candidate files and what was skipped. */
const walk = async (dir: string, warnings: string[]): Promise<Entry[]> => {
  const entries: Entry[] = []
  const visit = async (rel: string) => {
    const names = (await readdir(join(dir, rel))).sort()
    for (const name of names) {
      const path = rel ? `${rel}/${name}` : name
      if (name === 'node_modules' || name.startsWith('.')) continue
      const stats = await lstat(join(dir, path))
      if (stats.isSymbolicLink()) warnings.push(`${path}: symbolic link ignored`)
      else if (stats.isDirectory()) await visit(path)
      else if (stats.isFile()) entries.push({ path, size: stats.size })
      else warnings.push(`${path}: special file ignored`)
    }
  }
  await visit('')
  return entries
}

const splitFrontmatter = (source: string): { data: any, body: string } | undefined => {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return undefined
  let data: any
  try { data = parseYaml(match[1]) } catch { return undefined }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  return { data, body: text.slice(match[0].length) }
}

/** Turns one extracted registry package directory into a Skill with attached text resources. */
export const parseSkillPackage = async (dir: string): Promise<{ skill: Skill, warnings: string[] } | { error: string }> => {
  const warnings: string[] = []
  let entries: Entry[]
  try { entries = await walk(dir, warnings) } catch (err) { return { error: `cannot read package: ${(err as Error).message}` } }

  // package.json is never served; unsupported types are ignored and count toward no limit
  const accepted: Entry[] = []
  const paths = new Set<string>()
  for (const entry of entries) {
    if (entry.path === 'package.json') continue
    if (!isSafePath(entry.path)) return { error: `unsafe path ${entry.path}` }
    if (!entry.path.split('/').every(segment => SEGMENT_PATTERN.test(segment))) {
      warnings.push(`${entry.path}: file name outside [A-Za-z0-9._-] ignored`)
      continue
    }
    if (entry.path !== 'SKILL.md' && entry.path.endsWith('/SKILL.md')) {
      warnings.push(`${entry.path}: nested SKILL.md ignored`)
      continue
    }
    if (entry.path !== 'SKILL.md' && !MIME_TYPES[extensionOf(entry.path)]) {
      warnings.push(`${entry.path}: unsupported file type ignored`)
      continue
    }
    if (paths.has(entry.path)) return { error: `duplicate path ${entry.path}` }
    paths.add(entry.path)
    accepted.push(entry)
  }
  if (!paths.has('SKILL.md')) return { error: 'SKILL.md not found' }
  if (accepted.length > SKILL_LIMITS.files) return { error: `too many files (${accepted.length}, max ${SKILL_LIMITS.files})` }
  for (const { path, size } of accepted) {
    if (size > SKILL_LIMITS.fileSize) return { error: `${path} is larger than ${SKILL_LIMITS.fileSize} bytes` }
  }
  if (accepted.reduce((sum, e) => sum + e.size, 0) > SKILL_LIMITS.total) return { error: `package is larger than ${SKILL_LIMITS.total} bytes` }

  const texts = new Map<string, string>()
  for (const { path } of accepted) {
    // a read failure throws (the extraction is unreliable, not the package invalid); only a bad decode is a verdict
    const content = await readFile(join(dir, path))
    try { texts.set(path, utf8.decode(content)) } catch { return { error: `${path} is not valid UTF-8 text` } }
  }

  const parsed = splitFrontmatter(texts.get('SKILL.md')!)
  if (!parsed) return { error: 'SKILL.md has no valid frontmatter' }
  const { name, description, metadata } = parsed.data
  if (typeof name !== 'string' || name.length > MAX_NAME || !NAME_PATTERN.test(name)) return { error: 'invalid skill name' }
  if (typeof description !== 'string' || !description.trim() || description.length > MAX_DESCRIPTION) return { error: 'invalid skill description' }

  const skill: Skill = {
    name,
    description,
    body: parsed.body,
    digest: 'sha256:' + createHash('sha256').update(parsed.body).digest('hex')
  }
  const tools = metadata?.tools
  if (typeof tools === 'string' && tools.trim()) skill.tools = tools.trim().split(/\s+/)
  else if (tools !== undefined && typeof tools !== 'string') warnings.push('metadata.tools ignored: not a space-separated string')
  skill.resources = accepted
    .filter(e => e.path !== 'SKILL.md')
    .map((e): SkillResource => ({ path: e.path, mimeType: MIME_TYPES[extensionOf(e.path)], text: texts.get(e.path)! }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { skill, warnings }
}
