export type MoveNudgeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** Photoshop-style Move-tool keyboard nudge in document pixels. */
export function moveNudgeDelta(key: string, accelerated: boolean): { dx: number; dy: number } | null {
  const step = accelerated ? 10 : 1
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 }
    case 'ArrowRight': return { dx: step, dy: 0 }
    case 'ArrowUp': return { dx: 0, dy: -step }
    case 'ArrowDown': return { dx: 0, dy: step }
    default: return null
  }
}
