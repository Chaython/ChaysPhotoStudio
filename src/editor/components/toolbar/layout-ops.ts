// ============================================================
// Chay's Photo Studio — toolbar layout operations (TASK 18)
//
// Pure functions over ToolbarSection[] shared by the live
// toolbar rail (drag & drop to pin / regroup) and the
// Customize Toolbar dialog. Each op returns a NEW array — or
// the SAME reference for genuine no-ops — so callers can cheaply
// skip no-op store writes.
// ============================================================
import type { ToolId, ToolbarSection } from '../../types'

export type Sections = ToolbarSection[]

export function findTool(sections: Sections, toolId: ToolId): { sec: number; idx: number } | null {
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s]
    if (sec.kind === 'single') {
      if (sec.tool === toolId) return { sec: s, idx: 0 }
    } else {
      const idx = sec.tools.indexOf(toolId)
      if (idx >= 0) return { sec: s, idx }
    }
  }
  return null
}

/** remove a tool; empty flyouts drop, 1-tool flyouts KEEP their group shape */
export function removeTool(sections: Sections, toolId: ToolId): Sections {
  const out: Sections = []
  for (const sec of sections) {
    if (sec.kind === 'single') {
      if (sec.tool !== toolId) out.push(sec)
    } else {
      const tools = sec.tools.filter(t => t !== toolId)
      if (tools.length) out.push({ kind: 'group', tools })
    }
  }
  return out
}

/** pin: tool becomes a standalone top-level button right before its old flyout */
export function pinToTop(sections: Sections, toolId: ToolId): Sections {
  const loc = findTool(sections, toolId)
  if (!loc || sections[loc.sec].kind === 'single') return sections
  const without = removeTool(sections, toolId)
  const at = Math.min(loc.sec, without.length)
  return [...without.slice(0, at), { kind: 'single', tool: toolId }, ...without.slice(at)]
}

/** append the tool to the flyout identified by any current member */
export function moveToGroup(sections: Sections, toolId: ToolId, groupMember: ToolId): Sections {
  if (toolId === groupMember) return sections
  const without = removeTool(sections, toolId)
  const gi = without.findIndex(s => s.kind === 'group' && s.tools.includes(groupMember))
  if (gi < 0) return sections
  const tools = [...(without[gi] as { kind: 'group'; tools: ToolId[] }).tools, toolId]
  const next = [...without]
  next[gi] = { kind: 'group', tools }
  return next
}

/** the tool becomes a fresh single-tool flyout where it currently sits */
export function newFlyout(sections: Sections, toolId: ToolId): Sections {
  const loc = findTool(sections, toolId)
  if (!loc) return sections
  const without = removeTool(sections, toolId)
  const at = Math.min(loc.sec, without.length)
  return [...without.slice(0, at), { kind: 'group', tools: [toolId] }, ...without.slice(at)]
}

/** ▲▼ for a tool: inside a flyout = reorder within it; pinned = swap the section */
export function nudgeTool(sections: Sections, toolId: ToolId, dir: -1 | 1): Sections {
  const loc = findTool(sections, toolId)
  if (!loc) return sections
  const sec = sections[loc.sec]
  if (sec.kind === 'group') {
    const to = loc.idx + dir
    if (to < 0 || to >= sec.tools.length) return sections
    const tools = [...sec.tools]
    ;[tools[loc.idx], tools[to]] = [tools[to], tools[loc.idx]]
    const next = [...sections]
    next[loc.sec] = { kind: 'group', tools }
    return next
  }
  return nudgeSectionAt(sections, loc.sec, dir)
}

export function nudgeSectionAt(sections: Sections, i: number, dir: -1 | 1): Sections {
  const to = i + dir
  if (to < 0 || to >= sections.length) return sections
  const next = [...sections]
  ;[next[i], next[to]] = [next[to], next[i]]
  return next
}

/** DnD: drop ON a row → insert before that row in its container
 *  (target in a flyout = join at that spot; target pinned = new
 *  pinned button right before it) */
export function insertBefore(sections: Sections, toolId: ToolId, targetTool: ToolId): Sections {
  if (toolId === targetTool) return sections
  const without = removeTool(sections, toolId)
  const loc = findTool(without, targetTool)
  if (!loc) return sections
  const sec = without[loc.sec]
  if (sec.kind === 'group') {
    const tools = [...sec.tools]
    tools.splice(loc.idx, 0, toolId)
    const next = [...without]
    next[loc.sec] = { kind: 'group', tools }
    return next
  }
  const next = [...without]
  next.splice(loc.sec, 0, { kind: 'single', tool: toolId })
  return next
}

/** drop on the preview strip background → own button at the end of the rail */
export function appendPinned(sections: Sections, toolId: ToolId): Sections {
  const without = removeTool(sections, toolId)
  return [...without, { kind: 'single', tool: toolId }]
}
