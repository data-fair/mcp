/**
 * The datasets server's contract: data-fair's published-catalog tools under the names the
 * released server gave them. A fixed list, not a scope: the catalog listing and the account
 * listing carry the same security, so no scope set separates them.
 */
import { createHash } from 'node:crypto'
import type { Skill, ToolSet } from '@data-fair/openapi-mcp'

/** datasets server name → platform tool name, in the order the tools are served */
export const DATASETS_TOOLS: Record<string, string> = {
  list_datasets: 'datafair_list_datasets',
  describe_dataset: 'datafair_describe_dataset',
  search_data: 'datafair_search_data',
  get_field_values: 'datafair_get_field_values',
  aggregate_data: 'datafair_aggregate_data',
  calculate_metric: 'datafair_calculate_metric'
}

/** Platform tools the datasets server does not have, named in texts by their counterpart here (the published catalog's listing). */
const TEXT_ALIASES: Record<string, string> = { datafair_list_account_datasets: 'list_datasets' }

/**
 * The mapped tools of a platform set, renamed; the skills and guides whose tools are all mapped
 * (a skill naming no tools stays), their tool lists renamed. `missing` lists the mapped names
 * the platform set does not have: left out, never invented.
 */
export function datasetsToolSet (platform: ToolSet): { toolSet: ToolSet, missing: string[] } {
  const rename = new Map(Object.entries(DATASETS_TOOLS).map(([name, platformName]) => [platformName, name]))
  const textRename = new Map([...rename, ...Object.entries(TEXT_ALIASES)])
  const byName = new Map(platform.tools.map(t => [t.name, t]))
  const tools: ToolSet['tools'] = []
  const missing: string[] = []
  for (const [name, platformName] of Object.entries(DATASETS_TOOLS)) {
    const tool = byName.get(platformName)
    if (tool) tools.push(withRenamedTexts({ ...tool, name }, textRename))
    else missing.push(name)
  }
  const served = new Set(tools.map(t => t.name))
  const renamed = (names: string[]) => names.map(n => rename.get(n))
  const allServed = (names: (string | undefined)[]): names is string[] => names.every(n => n !== undefined && served.has(n))
  const skills: ToolSet['skills'] = []
  for (const skill of platform.skills) {
    if (!skill.tools?.length) { skills.push(withRenamedBody(skill, textRename)); continue }
    const names = renamed(skill.tools)
    if (allServed(names)) skills.push(withRenamedBody({ ...skill, tools: names }, textRename))
  }
  const guides: ToolSet['guides'] = []
  for (const guide of platform.guides) {
    const names = renamed(guide.tools)
    if (allServed(names)) guides.push({ ...guide, tools: names })
  }
  return { toolSet: { tools, skills, guides }, missing }
}

/**
 * A skill's body names the tools by their platform names, as text: those this server renames are
 * renamed there too (and its digest follows), so the body names the tools a caller actually has.
 */
function renameTools (text: string, rename: Map<string, string>): string {
  return text.replace(/\bdatafair_[a-z0-9_]+\b/g, name => rename.get(name) ?? name)
}

/** A tool's description and every description inside its schemas name the tools too: renamed the same way. */
function withRenamedTexts (tool: ToolSet['tools'][number], rename: Map<string, string>): ToolSet['tools'][number] {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return renameTools(value, rename)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'description' || typeof v === 'object' ? walk(v) : v]))
    return value
  }
  return {
    ...tool,
    description: renameTools(tool.description, rename),
    inputSchema: walk(tool.inputSchema) as typeof tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: walk(tool.outputSchema) as typeof tool.outputSchema } : {})
  }
}

function withRenamedBody (skill: Skill, rename: Map<string, string>): Skill {
  const body = renameTools(skill.body, rename)
  if (body === skill.body) return skill
  return { ...skill, body, digest: `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}` }
}

/**
 * Platform tools the datasets server alone serves. The platform server is the back-office, where
 * a call's outcome does not depend on the site it is made from; the published catalog of the
 * site called from (list_datasets) is a visitor's view, which only that site answers, and its
 * back-office counterpart is list_account_datasets.
 */
export const DATASETS_ONLY_TOOLS = new Set(['datafair_list_datasets'])

/** The platform set without the datasets-only tools; a skill or guide loses their names and goes if that leaves it none. */
export function backOfficeToolSet (platform: ToolSet): ToolSet {
  const kept = (names: string[]) => names.filter(name => !DATASETS_ONLY_TOOLS.has(name))
  const skills: ToolSet['skills'] = []
  for (const skill of platform.skills) {
    if (!skill.tools?.length) { skills.push(skill); continue }
    const tools = kept(skill.tools)
    if (tools.length) skills.push({ ...skill, tools })
  }
  const guides: ToolSet['guides'] = []
  for (const guide of platform.guides) {
    const tools = kept(guide.tools)
    if (tools.length) guides.push({ ...guide, tools })
  }
  return { tools: platform.tools.filter(t => !DATASETS_ONLY_TOOLS.has(t.name)), skills, guides }
}
