import type { Layer, PathAnchor } from '../types'

export type VectorMask = NonNullable<Layer['vectorMask']>
export type VectorMaskOp = 'add' | 'subtract' | 'intersect' | 'exclude'
export interface VectorMaskComponent {
  anchors: PathAnchor[]
  closed: boolean
  op: VectorMaskOp
}

export function vectorMaskComponents(mask: VectorMask): VectorMaskComponent[] {
  if (mask.paths?.length) {
    return mask.paths
      .filter(p => Array.isArray(p.anchors) && p.anchors.length >= 2)
      .map(p => ({
        anchors: p.anchors,
        closed: !!p.closed,
        op: p.op ?? 'add',
      }))
  }
  return mask.anchors.length >= 2
    ? [{ anchors: mask.anchors, closed: !!mask.closed, op: 'add' }]
    : []
}

export function cloneVectorMask(mask: Layer['vectorMask']): Layer['vectorMask'] {
  if (!mask) return null
  return {
    ...mask,
    anchors: mask.anchors.map(a => ({ ...a })),
    paths: mask.paths?.map(p => ({
      ...p,
      anchors: p.anchors.map(a => ({ ...a })),
    })),
  }
}

export function mapVectorMask(
  mask: Layer['vectorMask'],
  mapAnchor: (anchor: PathAnchor) => PathAnchor,
): Layer['vectorMask'] {
  if (!mask) return null
  const anchors = mask.anchors.map(mapAnchor)
  return {
    ...mask,
    anchors,
    paths: mask.paths?.map(p => ({
      ...p,
      anchors: p.anchors.map(mapAnchor),
    })),
  }
}

export function normalizeVectorMask(
  raw: any,
): Layer['vectorMask'] {
  if (!raw || !Array.isArray(raw.anchors)) return null
  const cleanAnchor = (a: any): PathAnchor => ({
    x: Number(a?.x) || 0,
    y: Number(a?.y) || 0,
    inX: Number(a?.inX) || 0,
    inY: Number(a?.inY) || 0,
    outX: Number(a?.outX) || 0,
    outY: Number(a?.outY) || 0,
    pair: a?.pair !== false,
  })
  const paths = Array.isArray(raw.paths)
    ? raw.paths
        .filter((p: any) => p && Array.isArray(p.anchors))
        .map((p: any) => ({
          op: p.op === 'subtract' || p.op === 'intersect' || p.op === 'exclude' ? p.op : 'add',
          closed: !!p.closed,
          anchors: p.anchors.map(cleanAnchor),
        }))
    : undefined
  return {
    enabled: raw.enabled !== false,
    closed: !!raw.closed,
    anchors: raw.anchors.map(cleanAnchor),
    paths,
  }
}
