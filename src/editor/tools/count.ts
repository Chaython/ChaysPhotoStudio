// Photo/inspection Count Tool: click to mark a subject, drag markers to
// reposition, Shift-click a marker to assign the current counting group.
import type { PointerInfo, Tool } from '../types'
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { getOptions, drawCross } from './shared'
import { uid, downloadBlob } from '../utils/canvas'
import { MAX_COUNT_MARKERS, normalizeCountMarkers, countByGroup, type CountMarker } from '../count-markers'

let selected: { docId:string; id:string } | null=null
let moving: { docId:string; id:string; x:number; y:number; newX:number; newY:number } | null=null
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
function inDoc(p:PointerInfo):boolean {
  const d=engine.activeDoc
  return !!d && Number.isFinite(p.docX)&&Number.isFinite(p.docY)&&p.docX>=0&&p.docY>=0&&p.docX<d.width&&p.docY<d.height
}
function hit(x:number,y:number):CountMarker|null {
  const d=engine.activeDoc
  if(!d)return null
  const tol=10/Math.max(0.05,d.view.zoom)
  const markers=normalizeCountMarkers(d.countMarkers,d.width,d.height)
  return [...markers].reverse().find(m=>Math.hypot(x-m.x,y-m.y)<=tol)??null
}
function commit(docId:string, next:CountMarker[], label:string){
  const d=engine.activeDoc
  if(!d||d.id!==docId)return
  d.countMarkers=normalizeCountMarkers(next,d.width,d.height)
  engine.pushHistory(label,d)
  engine.emit()
  engine.pokeOverlay()
}
function currentId():string|null{
  return selected&&selected.docId===engine.activeDoc?.id?selected.id:null
}
export function exportCountMarkersCsv(): boolean {
  const d=engine.activeDoc
  if(!d)return false
  const markers=normalizeCountMarkers(d.countMarkers,d.width,d.height)
  if(!markers.length){useEditorStore.getState().pushToast('No count markers to export','info');return false}
  const indexes:Record<string,number>=Object.create(null)
  const csv=['Group,Index,X,Y']
  for(const m of markers){
    indexes[m.group]=(indexes[m.group]??0)+1
    csv.push([m.group,indexes[m.group],m.x,m.y].join(','))
  }
  // Annotation groups are validated, so no spreadsheet-formula payload is possible.
  const name=(d.name||'Document').replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,60)||'Document'
  downloadBlob(new Blob([csv.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}),name+'-count-markers.csv')
  return true
}
export const countTool:Tool={
  id:'count',cursor:'crosshair',
  onPointerDown(p){
    const d=engine.activeDoc
    if(p.button!==0||!inDoc(p)||!d)return
    const markers=normalizeCountMarkers(d.countMarkers,d.width,d.height)
    const found=hit(p.docX,p.docY)
    const group=String(getOptions('count').group??'1')
    if(found){
      selected={docId:d.id,id:found.id}
      if(p.alt){
        moving=null
        commit(d.id,markers.filter(m=>m.id!==found.id),'Delete Count Marker')
        selected=null
      }else if(p.shift && found.group!==group){
        commit(d.id,markers.map(m=>m.id===found.id?{...m,group}:m),'Regroup Count Marker')
      }else moving={docId:d.id,id:found.id,x:found.x,y:found.y,newX:found.x,newY:found.y}
      engine.pokeOverlay()
      return
    }
    if(p.alt)return
    if(markers.length>=MAX_COUNT_MARKERS){useEditorStore.getState().pushToast('Count marker limit reached','error');return}
    const id=uid()
    selected={docId:d.id,id}
    commit(d.id,[...markers,{id,x:Math.round(p.docX),y:Math.round(p.docY),group}],'Add Count Marker')
  },
  onPointerMove(p){
    const d=engine.activeDoc,m=moving
    if(!d||!m||d.id!==m.docId)return
    m.newX=clamp(Math.round(p.docX),0,d.width-1)
    m.newY=clamp(Math.round(p.docY),0,d.height-1)
    engine.pokeOverlay()
  },
  onPointerUp(p){
    const d=engine.activeDoc,m=moving
    moving=null
    if(!d||!m||d.id!==m.docId)return
    const x=clamp(Math.round(p.docX),0,d.width-1),y=clamp(Math.round(p.docY),0,d.height-1)
    if(x===m.x&&y===m.y){engine.pokeOverlay();return}
    commit(d.id,normalizeCountMarkers(d.countMarkers,d.width,d.height)
      .map(item=>item.id===m.id?{...item,x,y}:item),'Move Count Marker')
  },
  onKeyDown(e){
    const d=engine.activeDoc
    if(!d)return false
    if(e.key==='Escape'){moving=null;selected=null;engine.pokeOverlay();return true}
    const id=currentId()
    if(!id||e.ctrlKey||e.altKey||e.metaKey)return false
    const markers=normalizeCountMarkers(d.countMarkers,d.width,d.height)
    if(e.key==='Delete'||e.key==='Backspace'){
      commit(d.id,markers.filter(m=>m.id!==id),'Delete Count Marker')
      selected=null
      return true
    }
    const delta:Record<string,[number,number]>={
      ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1],
    }
    const dir=delta[e.key], marker=markers.find(m=>m.id===id)
    if(!dir||!marker)return false
    const n=e.shiftKey?10:1
    const x=clamp(marker.x+n*dir[0],0,d.width-1),y=clamp(marker.y+n*dir[1],0,d.height-1)
    if(x!==marker.x||y!==marker.y)commit(d.id,markers.map(m=>m.id===id?{...m,x,y}:m),'Nudge Count Marker')
    return true
  },
  onDeactivate(){moving=null;engine.pokeOverlay()},
  renderOverlay(ctx,view,w,h,mouse){
    const d=engine.activeDoc
    if(!d){drawCross(ctx,mouse);return}
    const markers=normalizeCountMarkers(d.countMarkers,d.width,d.height)
    const totals=countByGroup(markers),numbers:Record<string,number>=Object.create(null)
    const opts=getOptions('count'), radius=clamp(Number(opts.markerSize)||9,5,32)
    ctx.save()
    ctx.font='bold 11px ui-monospace,monospace'
    ctx.textAlign='center';ctx.textBaseline='middle'
    for(const item of markers){
      numbers[item.group]=(numbers[item.group]??0)+1
      const o=moving?.docId===d.id&&moving.id===item.id?moving:item
      const x=view.panX+(('newX' in o?o.newX:o.x))*view.zoom
      const y=view.panY+(('newY' in o?o.newY:o.y))*view.zoom
      if(x < -60 || y < -60 || x > w+60 || y > h+60)continue
      const active=item.id===currentId()
      ctx.fillStyle=active?'#facc15':'#38bdf8'
      ctx.strokeStyle='#082f49';ctx.lineWidth=1.7
      ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.stroke()
      ctx.fillStyle='#082f49'
      ctx.fillText(String(numbers[item.group]),x,y)
      if(opts.showLabels!==false){
        const caption=item.group+': '+numbers[item.group]+'/'+totals[item.group]
        ctx.font='10px ui-monospace,monospace'
        const width=ctx.measureText(caption).width+8
        ctx.fillStyle='rgba(0,0,0,.83)';ctx.fillRect(x+radius+3,y-9,width,18)
        ctx.fillStyle='#fff';ctx.textAlign='left';ctx.fillText(caption,x+radius+7,y)
        ctx.textAlign='center';ctx.font='bold 11px ui-monospace,monospace'
      }
    }
    ctx.restore()
    drawCross(ctx,mouse)
  },
}
