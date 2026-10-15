/** Non-destructive, project-persistent Photoshop-style Count Tool markers. */
export interface CountMarker {
  id: string
  x: number
  y: number
  group: string
}
export const MAX_COUNT_MARKERS = 2000
export function normalizeCountMarkers(input: unknown, width: number, height: number): CountMarker[] {
  if (!Array.isArray(input) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1) return []
  const seen=new Set<string>(), out:CountMarker[]=[]
  for (const value of input.slice(0,MAX_COUNT_MARKERS)) {
    if (!value || typeof value !== 'object') continue
    const v=value as Record<string,unknown>
    if(typeof v.id!=='string' || !v.id || v.id.length>100 || seen.has(v.id))continue
    if(typeof v.x!=='number'||typeof v.y!=='number'||!Number.isFinite(v.x)||!Number.isFinite(v.y))continue
    if(v.x<0||v.y<0||v.x>=width||v.y>=height)continue
    const group=typeof v.group==='string'&&/^[A-Za-z0-9 -]{1,30}$/.test(v.group)?v.group:'1'
    out.push({id:v.id,x:Math.min(width-1,Math.round(v.x)),y:Math.min(height-1,Math.round(v.y)),group})
    seen.add(v.id)
  }
  return out
}
export function countByGroup(markers:readonly CountMarker[]):Record<string,number> {
  const result:Record<string,number>=Object.create(null)
  for(const item of markers)result[item.group]=(result[item.group]??0)+1
  return result
}
