// Artboard geometry remains a document-space annotation, not a new layer tree.
// New/moved/resized boards reuse the existing artboard export and persistence model.
import type { PointerInfo, Tool } from '../types'
import type { Artboard } from '../artboards'
import { MAX_ARTBOARDS, normalizeArtboards } from '../artboards'
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { uid } from '../utils/canvas'
import { drawCross } from './shared'

type Rect = Pick<Artboard, 'x' | 'y' | 'width' | 'height'>
type Drag = { docId: string; kind: 'new' | 'move' | 'resize'; id: string | null;
  x: number; y: number; original?: Rect; draft: Rect }
let drag: Drag | null = null

const cap = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))
const point = (v: number, limit: number) => cap(Number.isFinite(v) ? Math.round(v) : 0, 0, limit - 1)
function boardAt(boards: Artboard[], x: number, y: number): Artboard | undefined {
  return [...boards].reverse().find(a => x >= a.x && y >= a.y && x < a.x+a.width && y < a.y+a.height)
}
function same(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
function boundedDrag(x: number, y: number, endX: number, endY: number, w: number, h: number, square: boolean): Rect {
  let dx = endX-x, dy = endY-y
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1)*side; dy = Math.sign(dy || 1)*side
  }
  const xx = cap(x+dx, 0, w-1), yy = cap(y+dy, 0, h-1)
  return { x: Math.min(x,xx), y: Math.min(y,yy), width: Math.abs(xx-x)+1, height: Math.abs(yy-y)+1 }
}
function commit(docId: string, boards: Artboard[], focused: string | null, label: string) {
  const doc = engine.activeDoc
  if (!doc || doc.id !== docId) return
  doc.artboards = normalizeArtboards(boards, doc.width, doc.height)
  doc.activeArtboardId = focused && doc.artboards.some(a => a.id === focused) ? focused : null
  doc.showArtboardOutlines = true
  engine.pushHistory(label, doc)
  engine.emit()
  engine.pokeOverlay()
}
export const artboardTool: Tool = {
  id: 'artboard', cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0 || p.docX < 0 || p.docY < 0 || p.docX >= doc.width || p.docY >= doc.height) return
    const boards = normalizeArtboards(doc.artboards, doc.width, doc.height)
    const hit = p.ctrl || p.meta ? undefined : boardAt(boards,p.docX,p.docY)
    if (p.alt && hit) {
      commit(doc.id, boards.filter(b=>b.id!==hit.id), null, 'Delete Artboard')
      return
    }
    const x=point(p.docX,doc.width), y=point(p.docY,doc.height)
    const tol=8 / Math.max(0.05,doc.view.zoom)
    const resize=!!hit && Math.hypot(p.docX-(hit.x+hit.width-1),p.docY-(hit.y+hit.height-1))<tol
    doc.activeArtboardId=hit?.id ?? null
    drag={docId:doc.id,kind:hit ? (resize?'resize':'move'):'new',
      id:hit?.id??null,x,y,
      original:hit?{x:hit.x,y:hit.y,width:hit.width,height:hit.height}:undefined,
      draft:hit?{x:hit.x,y:hit.y,width:hit.width,height:hit.height}:{x,y,width:1,height:1}}
    doc.showArtboardOutlines=true
    engine.pokeOverlay()
  },
  onPointerMove(p:PointerInfo) {
    const doc=engine.activeDoc, d=drag
    if (!doc || !d || d.docId!==doc.id) { drag=null; return }
    const x=point(p.docX,doc.width),y=point(p.docY,doc.height)
    if(d.kind==='new') d.draft=boundedDrag(d.x,d.y,x,y,doc.width,doc.height,p.shift)
    else if(d.original && d.kind==='move'){
      d.draft={...d.original,x:cap(d.original.x+x-d.x,0,doc.width-d.original.width),
        y:cap(d.original.y+y-d.y,0,doc.height-d.original.height)}
    } else if(d.original){
      const rx=Math.max(1,x-d.original.x+1),ry=Math.max(1,y-d.original.y+1), side=Math.max(rx,ry)
      d.draft={...d.original,width:Math.min(doc.width-d.original.x,p.shift?side:rx),
        height:Math.min(doc.height-d.original.y,p.shift?side:ry)}
    }
    engine.pokeOverlay()
  },
  onPointerUp(p:PointerInfo) {
    const d=drag,doc=engine.activeDoc
    if(!d) return
    if(!doc || doc.id!==d.docId){drag=null;return}
    this.onPointerMove?.(p)
    drag=null
    const boards=normalizeArtboards(doc.artboards,doc.width,doc.height)
    if(d.kind==='new'){
      if(d.draft.width<3 || d.draft.height<3){engine.pokeOverlay();return}
      if(boards.length>=MAX_ARTBOARDS){useEditorStore.getState().pushToast('Artboard limit reached','error');return}
      const id=uid()
      commit(doc.id,[...boards,{id,name:'Artboard '+(boards.length+1),...d.draft}],id,'Create Artboard')
    }else if(d.original && d.id && !same(d.draft,d.original)){
      commit(doc.id,boards.map(b=>b.id===d.id?{...b,...d.draft}:b),d.id,d.kind==='move'?'Move Artboard':'Resize Artboard')
    }else engine.pokeOverlay()
  },
  onKeyDown(e:KeyboardEvent){
    const doc=engine.activeDoc
    if(!doc)return false
    if(e.key==='Escape'){drag=null;doc.activeArtboardId=null;engine.pokeOverlay();return true}
    const id=doc.activeArtboardId
    if(!id||e.ctrlKey||e.metaKey)return false
    if(e.key==='Enter'){useEditorStore.getState().openDialog('artboards');return true}
    const boards=normalizeArtboards(doc.artboards,doc.width,doc.height)
    if(e.key==='Delete'||e.key==='Backspace'){
      commit(doc.id,boards.filter(b=>b.id!==id),null,'Delete Artboard');return true
    }
    const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}
    const delta=directions[e.key], board=boards.find(b=>b.id===id)
    if(!delta||!board)return false
    const step=e.shiftKey?10:1
    const x=cap(board.x+step*delta[0],0,doc.width-board.width)
    const y=cap(board.y+step*delta[1],0,doc.height-board.height)
    if(board.x!==x||board.y!==y)commit(doc.id,boards.map(b=>b.id===id?{...b,x,y}:b),id,'Nudge Artboard')
    return true
  },
  onDoubleClick(){if(engine.activeDoc)useEditorStore.getState().openDialog('artboards')},
  onDeactivate(){drag=null;engine.pokeOverlay()},
  renderOverlay(ctx,view,w,h,mouse){
    void w;void h
    const doc=engine.activeDoc,d=drag
    if(doc && d && d.docId===doc.id){
      const r=d.draft
      ctx.save()
      ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.setLineDash([5,3])
      ctx.strokeRect(view.panX+r.x*view.zoom,view.panY+r.y*view.zoom,r.width*view.zoom,r.height*view.zoom)
      ctx.restore()
    }
    drawCross(ctx,mouse)
  }
}
