import { readFileSync } from 'node:fs'
import { TOOL_CYCLES, TOOL_DEFS } from '../src/editor/constants/tools'
import { TOOLS } from '../src/editor/tools/registry'

const fail = (message: string): never => {
  throw new Error(`Tool validation failed: ${message}`)
}

const duplicates = <T>(items: T[]): T[] => {
  const seen = new Set<T>()
  const dup = new Set<T>()
  for (const item of items) {
    if (seen.has(item)) dup.add(item)
    else seen.add(item)
  }
  return [...dup]
}

const typesSource = readFileSync(new URL('../src/editor/types.ts', import.meta.url), 'utf8')
const registrySource = readFileSync(new URL('../src/editor/tools/registry.ts', import.meta.url), 'utf8')

const toolIdBlock = typesSource.match(/export type ToolId\s*=([\s\S]*?)\n\nexport type SelectionCombine/)
if (!toolIdBlock) fail('could not parse ToolId union')
const typeIds = [...toolIdBlock![1].matchAll(/'([^']+)'/g)].map(m => m[1])

const registryBlock = registrySource.match(/export const TOOLS:[\s\S]*?=\s*\{([\s\S]*?)\n\}/)
if (!registryBlock) fail('could not parse TOOLS registry')
const registryIds = [...registryBlock![1].matchAll(/^\s*'([^']+)'\s*:/gm)].map(m => m[1])

const defIds = TOOL_DEFS.map(t => t.id as string)
for (const [label, ids] of [
  ['ToolId', typeIds],
  ['TOOL_DEFS', defIds],
  ['TOOLS registry', registryIds],
] as const) {
  const dup = duplicates(ids)
  if (dup.length) fail(`${label} contains duplicate IDs: ${dup.join(', ')}`)
}

const expected = new Set(typeIds)
const assertSameIds = (label: string, ids: string[]) => {
  const got = new Set(ids)
  const missing = typeIds.filter(id => !got.has(id))
  const extra = ids.filter(id => !expected.has(id))
  if (missing.length || extra.length) {
    fail(`${label} differs from ToolId; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`)
  }
}
assertSameIds('TOOL_DEFS', defIds)
assertSameIds('TOOLS registry', registryIds)
assertSameIds('loaded TOOLS', Object.keys(TOOLS))

for (const [id, tool] of Object.entries(TOOLS)) {
  if (tool.id !== id) fail(`registry key "${id}" loads a tool whose id is "${tool.id}"`)
  if (!tool.onPointerDown && !tool.onKeyDown && !tool.onDoubleClick) {
    fail(`${id} exposes no interaction handler`)
  }
  const def = TOOL_DEFS.find(d => d.id === id)
  if (!def) throw new Error(`Tool validation failed: ${id} loaded without a ToolDef`)
  if (!!def.requiresLayer !== !!tool.requiresLayer) {
    fail(`${id} requiresLayer differs between ToolDef (${!!def.requiresLayer}) and implementation (${!!tool.requiresLayer})`)
  }
}

const cycleIds = TOOL_CYCLES.flat().map(String)
for (const id of cycleIds) if (!expected.has(id)) fail(`TOOL_CYCLES references unknown tool "${id}"`)
const cycleDup = duplicates(cycleIds)
if (cycleDup.length) fail(`tools appear in multiple TOOL_CYCLES groups: ${cycleDup.join(', ')}`)
for (const cycle of TOOL_CYCLES) {
  if (cycle.length < 2) fail(`TOOL_CYCLES contains a group with fewer than two tools: ${cycle.join(', ')}`)
}

for (const def of TOOL_DEFS) {
  if (!def.label?.trim()) fail(`${def.id} has an empty label`)
  if (!def.icon?.trim()) fail(`${def.id} has an empty icon`)

  const controls = def.options ?? []
  const keys = controls.map(c => c.key)
  const keyDup = duplicates(keys)
  if (keyDup.length) fail(`${def.id} contains duplicate control keys: ${keyDup.join(', ')}`)

  for (const control of controls) {
    if (!control.label?.trim()) fail(`${def.id}.${control.key} has an empty control label`)
    if (control.type === 'slider' || control.type === 'number') {
      if (control.min !== undefined && control.max !== undefined && control.min > control.max) {
        fail(`${def.id}.${control.key} has min > max`)
      }
      const value = def.defaults?.[control.key]
      if (typeof value === 'number') {
        if (control.min !== undefined && value < control.min) fail(`${def.id}.${control.key} default is below min`)
        if (control.max !== undefined && value > control.max) fail(`${def.id}.${control.key} default is above max`)
      }
    }
    if (control.type === 'select') {
      const values = (control.options ?? []).map(o => String(o.value))
      const dup = duplicates(values)
      if (dup.length) fail(`${def.id}.${control.key} contains duplicate select values: ${dup.join(', ')}`)
      const current = def.defaults?.[control.key]
      if (current !== undefined && values.length && !values.includes(String(current))) {
        fail(`${def.id}.${control.key} default "${String(current)}" is not a select option`)
      }
    }
  }
}

console.log(
  `Validated ${typeIds.length} tools: ToolId, definitions, registry, cycles, control schemas and defaults are consistent.`,
)
