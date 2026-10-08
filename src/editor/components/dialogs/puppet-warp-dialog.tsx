'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { puppetWarpMesh, warpCanvasToMesh, type PuppetWarpPin } from '../../image-ops/transform'
import { clamp, createCanvas, ctx2d, uid } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import type { DialogProps } from './generic-dialogs'

const PW=560, PH=380

function previewRect(source:HTMLCanvasElement|null){
  if(!source)return {x:30,y:30,w:PW-60,h:PH-60}
  const maxW=PW-70,maxH=PH-70
  const scale=Math.min(maxW/source.width,maxH/source.height)
  const w=Math.max(1,source.width*scale),h=Math.max(1,source.height*scale)
  return {x:(PW-w)/2,y:(PH-h)/2,w,h}
}

function normalizePointer(canvas:HTMLCanvasElement,clientX:number,clientY:number,source:HTMLCanvasElement|null){
  const b=canvas.getBoundingClientRect()
  const x=(clientX-b.left)*canvas.width/Math.max(1,b.width)
  const y=(clientY-b.top)*canvas.height/Math.max(1,b.height)
  const r=previewRect(source)
  return {
    px:x,py:y,
    x:(x-r.x)/Math.max(1,r.w),
    y:(y-r.y)/Math.max(1,r.h),
    rect:r,
  }
}

export function PuppetWarpDialog({ inst,onClose }:DialogProps){
  const layerId=String(inst.props?.layerId??engine.activeLayer?.id??'')
  const layer=layerId?engine.layerById(layerId):null
  const doc=engine.activeDoc
  const [sourceDocumentId]=useState(()=>doc?.id ?? null)
  const [source]=useState(()=>{
    const raw=layerId?engine.warpSourceCanvas(layerId):null
    if(!raw)return null
    const maxDim=720
    const scale=Math.min(1,maxDim/Math.max(raw.width,raw.height))
    if(scale>=1)return raw
    const out=createCanvas(Math.max(1,Math.round(raw.width*scale)),Math.max(1,Math.round(raw.height*scale)))
    const ctx=ctx2d(out)
    ctx.imageSmoothingEnabled=true
    ctx.imageSmoothingQuality='high'
    ctx.drawImage(raw,0,0,out.width,out.height)
    return out
  })
  const [pins,setPins]=useState<PuppetWarpPin[]>([])
  const [selected,setSelected]=useState<string|null>(null)
  const [density,setDensity]=useState(6)
  const [rigidity,setRigidity]=useState(55)
  const [showMesh,setShowMesh]=useState(true)
  const previewRef=useRef<HTMLCanvasElement|null>(null)
  const dragRef=useRef<string|null>(null)
  const hdrBlocked=!!(doc?.workingBitDepth===32&&layer?.kind==='raster'&&layer.hdrPixels)

  const mesh=useMemo(
    ()=>puppetWarpMesh(pins,density,rigidity,source?source.width/source.height:1),
    [pins,density,rigidity,source],
  )
  const activePin=pins.find(p=>p.id===selected)??null

  useEffect(()=>{
    const canvas=previewRef.current
    if(!canvas)return
    const ctx=ctx2d(canvas)
    ctx.clearRect(0,0,PW,PH)
    ctx.fillStyle='#202124';ctx.fillRect(0,0,PW,PH)
    const r=previewRect(source)

    // Transparency checker behind the editable source extent.
    const cell=10
    for(let y=Math.floor(r.y);y<r.y+r.h;y+=cell){
      for(let x=Math.floor(r.x);x<r.x+r.w;x+=cell){
        ctx.fillStyle=((Math.floor((x-r.x)/cell)+Math.floor((y-r.y)/cell))&1)?'#c7c7c7':'#efefef'
        ctx.fillRect(x,y,cell,cell)
      }
    }
    ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip()
    if(source){
      const dest=mesh.points.map(p=>({x:r.x+p.x*r.w,y:r.y+p.y*r.h}))
      const warped=warpCanvasToMesh(source,mesh,dest)
      ctx.drawImage(warped.canvas,warped.offsetX,warped.offsetY)
      if(showMesh){
        ctx.strokeStyle='rgba(0,220,255,.55)'
        ctx.lineWidth=1
        for(let row=0;row<mesh.v.length;row++){
          ctx.beginPath()
          for(let col=0;col<mesh.u.length;col++){
            const p=dest[row*mesh.u.length+col]
            if(col===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)
          }
          ctx.stroke()
        }
        for(let col=0;col<mesh.u.length;col++){
          ctx.beginPath()
          for(let row=0;row<mesh.v.length;row++){
            const p=dest[row*mesh.u.length+col]
            if(row===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)
          }
          ctx.stroke()
        }
      }
    }
    ctx.restore()

    for(const pin of pins){
      const x=r.x+pin.targetX*r.w,y=r.y+pin.targetY*r.h
      ctx.beginPath();ctx.arc(x,y,pin.id===selected?7:6,0,Math.PI*2)
      ctx.fillStyle=pin.id===selected?'#f6c453':'#f5f5f5';ctx.fill()
      ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.stroke()
      if(Math.abs(pin.rotation)>0.01){
        const rad=pin.rotation*Math.PI/180
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(rad)*18,y+Math.sin(rad)*18)
        ctx.strokeStyle='#f6c453';ctx.lineWidth=2;ctx.stroke()
      }
      ctx.font='10px sans-serif';ctx.fillStyle='#111';ctx.textAlign='center';ctx.textBaseline='middle'
      ctx.fillText(String(pin.depth),x,y)
    }
  },[source,mesh,pins,selected,showMesh])

  const addOrSelect=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(!source)return
    e.currentTarget.focus()
    const p=normalizePointer(e.currentTarget,e.clientX,e.clientY,source)
    const r=p.rect
    let hit:PuppetWarpPin|null=null
    let best=Infinity
    for(const pin of pins){
      const x=r.x+pin.targetX*r.w,y=r.y+pin.targetY*r.h
      const d=Math.hypot(p.px-x,p.py-y)
      if(d<12&&d<best){hit=pin;best=d}
    }
    if(hit){
      setSelected(hit.id);dragRef.current=hit.id
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if(p.x<0||p.x>1||p.y<0||p.y>1||pins.length>=10)return
    const pin:PuppetWarpPin={id:uid(),x:p.x,y:p.y,targetX:p.x,targetY:p.y,rotation:0,depth:0}
    setPins(prev=>[...prev,pin]);setSelected(pin.id);dragRef.current=pin.id
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const drag=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    const id=dragRef.current
    if(!id||!source)return
    const p=normalizePointer(e.currentTarget,e.clientX,e.clientY,source)
    setPins(prev=>prev.map(pin=>pin.id===id?{
      ...pin,
      targetX:clamp(p.x,-.5,1.5),
      targetY:clamp(p.y,-.5,1.5),
    }:pin))
  }

  const endDrag=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(dragRef.current&&e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current=null
  }

  const updateSelected=(patch:Partial<PuppetWarpPin>)=>{
    if(!selected)return
    setPins(prev=>prev.map(pin=>pin.id===selected?{...pin,...patch}:pin))
  }
  const deleteSelected=()=>{
    if(!selected)return
    setPins(prev=>prev.filter(pin=>pin.id!==selected));setSelected(null)
  }
  const reset=()=>{
    setPins(prev=>prev.map(pin=>({...pin,targetX:pin.x,targetY:pin.y,rotation:0,depth:0})))
  }

  const apply=()=>{
    if(!source||!layerId||!pins.length||hdrBlocked)return
    const liveDoc=engine.activeDoc
    const liveLayer=liveDoc?.layers.find(item=>item.id===layerId)
    if(!liveDoc||liveDoc.id!==sourceDocumentId||!liveLayer){
      useEditorStore.getState().pushToast('The original Puppet Warp layer is no longer active','error')
      return
    }
    if(liveLayer.locked||liveLayer.kind==='adjustment'){
      useEditorStore.getState().pushToast('Unlock the layer before applying Puppet Warp','error')
      return
    }
    const previousState=liveDoc.history.states[liveDoc.history.index]
    engine.transformLayer(layerId,{mode:'warp',warp:mesh})
    // Engine.transformLayer can reject a transform without throwing (e.g. a
    // missing pixel source). Only close and report success after a History entry.
    if(liveDoc.history.states[liveDoc.history.index]===previousState)return
    useEditorStore.getState().pushToast('Puppet Warp applied with '+pins.length+' pin'+(pins.length===1?'':'s'),'success')
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>Puppet Warp</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[10px] text-muted-foreground">
          Click to add pins, drag pins to deform, and select a pin to rotate or change its overlap priority. Smart Objects keep the resulting mesh non-destructively.
        </div>

        <canvas
          ref={previewRef}
          width={PW}
          height={PH}
          tabIndex={0}
          onPointerDown={addOrSelect}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected()}}}
          className="w-full max-h-[380px] rounded border border-border touch-none cursor-crosshair outline-none focus:ring-1 focus:ring-ring"
          aria-label="Puppet Warp pin editor"
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Mesh Density</Label>
            <Select value={String(density)} onValueChange={v=>setDensity(Number(v))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="4" className="text-xs">Fewer Points</SelectItem>
                <SelectItem value="6" className="text-xs">Normal</SelectItem>
                <SelectItem value="10" className="text-xs">More Points</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Rigidity: {rigidity}%</Label>
            <input type="range" min={0} max={100} value={rigidity} onChange={e=>setRigidity(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px] cursor-pointer">
          <input type="checkbox" checked={showMesh} onChange={e=>setShowMesh(e.target.checked)} className="accent-primary" />
          Show Mesh
        </label>

        {activePin ? (
          <div className="rounded border border-border/60 p-2 space-y-2">
            <div className="text-[10px] font-medium">Selected Pin</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Rotation (°)</Label>
                <Input type="number" min={-180} max={180} value={Math.round(activePin.rotation*10)/10} onChange={e=>updateSelected({rotation:clamp(Number(e.target.value),-180,180)})} className="h-7 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Depth / Priority: {activePin.depth}</Label>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="secondary" onClick={()=>updateSelected({depth:clamp(activePin.depth-1,-20,20)})}>Down</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={()=>updateSelected({depth:clamp(activePin.depth+1,-20,20)})}>Up</Button>
                </div>
              </div>
            </div>
            <Button type="button" size="sm" variant="destructive" onClick={deleteSelected}>Delete Pin</Button>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">No pin selected · {pins.length}/10 pins</div>
        )}

        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={!pins.length}>Reset Deformation</Button>
          <Button type="button" size="sm" variant="secondary" onClick={()=>{setPins([]);setSelected(null)}} disabled={!pins.length}>Clear Pins</Button>
        </div>

        {hdrBlocked && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px]">
            Puppet Warp is disabled for raster layers with authoritative 32-bit HDR pixels until mesh rasterization operates directly on scene-linear Float32 data. Smart Objects remain non-destructive.
          </div>
        )}
        {!source && <div className="text-[10px] text-destructive">The active layer has no warpable pixel source.</div>}
      </div>
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={!source||!pins.length||hdrBlocked||!layer||layer.locked||doc?.id!==sourceDocumentId}>Apply Puppet Warp</Button>
      </DialogFooter>
    </>
  )
}
