import type { Skill, ToolSet } from '@data-fair/openapi-mcp'

const MAX_SKILLS = 50

/**
 * The platform set of a caller (already cut by its scopes, so "granted" means present in
 * base.tools) plus the registry skills visible to it. A registry skill never changes a tool: it
 * only loses the tool names the caller does not have, and goes if that leaves it none. An API-doc
 * skill wins a name collision. API-doc skills come first.
 */
export function composeSkills (base: ToolSet, registry: Skill[]): ToolSet {
  const granted = new Set(base.tools.map(t => t.name))
  const taken = new Set(base.skills.map(s => s.name))
  const kept: Skill[] = []
  for (const skill of registry) {
    if (taken.has(skill.name)) {
      console.warn(`registry skill "${skill.name}" dropped: an API-doc skill has the same name`)
      continue
    }
    if (skill.tools?.length) {
      const tools = skill.tools.filter(name => granted.has(name))
      if (!tools.length) continue
      kept.push({ ...skill, tools })
    } else kept.push(skill)
    taken.add(skill.name)
  }
  const skills = [...base.skills, ...kept]
  if (skills.length > MAX_SKILLS) console.warn(`${skills.length} skills served, more than ${MAX_SKILLS}`)
  return kept.length ? { ...base, skills } : base
}
