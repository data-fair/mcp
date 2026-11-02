import type { Skill, ToolSet } from '@data-fair/openapi-mcp'
import type { RegistrySkill } from './registry.ts'

const MAX_SKILLS = 50

// composeSkills runs on every request: each distinct situation is logged once
const logged = new Set<string>()
const warnOnce = (message: string) => {
  if (logged.has(message)) return
  logged.add(message)
  console.warn(message)
}

/**
 * The platform set of a caller (already cut by its scopes, so "granted" means present in
 * base.tools) plus the registry skills visible to it. A registry skill never changes a tool: it
 * only loses the tool names the caller does not have, and goes if that leaves it none. An API-doc
 * skill wins a name collision; between registry skills of one name, the artefact whose id sorts
 * last wins (`…-2` over `…-1`), before tools are cut. API-doc skills come first.
 */
export function composeSkills (base: ToolSet, registry: RegistrySkill[]): ToolSet {
  const granted = new Set(base.tools.map(t => t.name))
  const docNames = new Set(base.skills.map(s => s.name))
  const winners = new Map<string, RegistrySkill>()
  for (const entry of registry) {
    const other = winners.get(entry.skill.name)
    if (other && other.id > entry.id) continue
    winners.set(entry.skill.name, entry)
  }
  const kept: Skill[] = []
  for (const { id, skill } of registry) {
    const winner = winners.get(skill.name)!
    if (winner.id !== id) {
      warnOnce(`registry skill "${skill.name}" of ${id} dropped: ${winner.id} has the same name and sorts last`)
      continue
    }
    if (docNames.has(skill.name)) {
      warnOnce(`registry skill "${skill.name}" of ${id} dropped: an API-doc skill has the same name`)
      continue
    }
    if (skill.tools?.length) {
      const tools = skill.tools.filter(name => granted.has(name))
      if (!tools.length) continue
      kept.push({ ...skill, tools })
    } else kept.push(skill)
  }
  const skills = [...base.skills, ...kept]
  if (skills.length > MAX_SKILLS) warnOnce(`${skills.length} skills served, more than ${MAX_SKILLS}`)
  return kept.length ? { ...base, skills } : base
}
