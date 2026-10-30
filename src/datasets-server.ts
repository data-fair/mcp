/**
 * The datasets server's contract: data-fair's published-catalog tools under the names the
 * released server gave them. A fixed list, not a scope: the catalog listing and the account
 * listing carry the same security, so no scope set separates them.
 */
import type { ToolSet } from '@data-fair/openapi-mcp'

/** datasets server name → platform tool name, in the order the tools are served */
export const DATASETS_TOOLS: Record<string, string> = {
  list_datasets: 'datafair_list_datasets',
  describe_dataset: 'datafair_describe_dataset',
  search_data: 'datafair_search_data',
  get_field_values: 'datafair_get_field_values',
  aggregate_data: 'datafair_aggregate_data',
  calculate_metric: 'datafair_calculate_metric'
}

/**
 * The mapped tools of a platform set, renamed; the skills and guides whose tools are all mapped
 * (a skill naming no tools stays), their tool lists renamed. `missing` lists the mapped names
 * the platform set does not have: left out, never invented.
 */
export function datasetsToolSet (platform: ToolSet): { toolSet: ToolSet, missing: string[] } {
  const rename = new Map(Object.entries(DATASETS_TOOLS).map(([name, platformName]) => [platformName, name]))
  const byName = new Map(platform.tools.map(t => [t.name, t]))
  const tools: ToolSet['tools'] = []
  const missing: string[] = []
  for (const [name, platformName] of Object.entries(DATASETS_TOOLS)) {
    const tool = byName.get(platformName)
    if (tool) tools.push({ ...tool, name })
    else missing.push(name)
  }
  const served = new Set(tools.map(t => t.name))
  const renamed = (names: string[]) => names.map(n => rename.get(n))
  const allServed = (names: (string | undefined)[]): names is string[] => names.every(n => n !== undefined && served.has(n))
  const skills: ToolSet['skills'] = []
  for (const skill of platform.skills) {
    if (!skill.tools?.length) { skills.push(skill); continue }
    const names = renamed(skill.tools)
    if (allServed(names)) skills.push({ ...skill, tools: names })
  }
  const guides: ToolSet['guides'] = []
  for (const guide of platform.guides) {
    const names = renamed(guide.tools)
    if (allServed(names)) guides.push({ ...guide, tools: names })
  }
  return { toolSet: { tools, skills, guides }, missing }
}
