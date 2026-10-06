'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { DEFAULT_PROOF_SETTINGS, parseMatrixRgbIcc } from '../../engine/color-proof'
import { useEditorStore } from '../../store'
import type { ProofProfileId, ProofSettings } from '../../types'
import type { DialogProps } from './generic-dialogs'

const PROFILE_LABELS: Record<ProofProfileId,string> = {
  'srgb':'sRGB IEC61966-2.1',
  'display-p3':'Display P3',
  'adobe-rgb':'Adobe RGB (1998)',
  'cmyk-swop':'Working CMYK — U.S. Web Coated (SWOP) approximation',
  'gray-20':'Working Gray — Dot Gain 20%',
  'custom-rgb':'Custom matrix RGB ICC',
}

function CheckRow(props:{label:string;checked:boolean;onChange:(v:boolean)=>void;disabled?:boolean}) {
  return (
    <label className={'flex items-center gap-2 text-[11px] ' + (props.disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={e=>props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

export function ProofSetupDialog({ onClose }: DialogProps) {
  const doc=engine.activeDoc
  const original=useRef<ProofSettings>({
    ...DEFAULT_PROOF_SETTINGS,
    ...(doc?.proof ?? {}),
  })
  const committed=useRef(false)
  const [settings,setSettings]=useState<ProofSettings>(()=>structuredClone(original.current))
  const [iccMessage,setIccMessage]=useState('')
  const initialDocId=doc?.id

  useEffect(()=>{
    if(engine.activeDoc?.id===initialDocId) engine.setProofSettings(settings)
  },[settings,initialDocId])

  useEffect(()=>()=>{
    if(!committed.current && engine.activeDoc?.id===initialDocId) {
      engine.setProofSettings(original.current)
    }
  },[initialDocId])

  const profileLabel=useMemo(()=>{
    if(settings.profile==='custom-rgb') return settings.customProfileName || PROFILE_LABELS['custom-rgb']
    return PROFILE_LABELS[settings.profile]
  },[settings.profile,settings.customProfileName])

  const patch=<K extends keyof ProofSettings>(key:K,value:ProofSettings[K])=>{
    setSettings(cur=>({...cur,[key]:value}))
  }

  const importIcc=()=>{
    const input=document.createElement('input')
    input.type='file'
    input.accept='.icc,.icm,application/vnd.iccprofile'
    input.onchange=async()=>{
      const file=input.files?.[0]
      if(!file)return
      try{
        const bytes=new Uint8Array(await file.arrayBuffer())
        const parsed=parseMatrixRgbIcc(bytes,file.name)
        if(!parsed){
          setIccMessage('Unsupported ICC. This proof pass supports RGB matrix-shaper profiles with rXYZ/gXYZ/bXYZ tags; LUT and CMYK ICC profiles are not approximated as if they were exact.')
          return
        }
        setSettings(cur=>({
          ...cur,
          profile:'custom-rgb',
          customMatrix:parsed.matrix,
          customProfileName:parsed.name,
        }))
        setIccMessage('Loaded ' + parsed.name)
      }catch(err){
        setIccMessage('ICC load failed' + (err instanceof Error && err.message ? ': '+err.message : ''))
      }
    }
    input.click()
  }

  const cancel=()=>{
    if(engine.activeDoc?.id===initialDocId) engine.setProofSettings(original.current)
    onClose()
  }

  const apply=()=>{
    committed.current=true
    if(engine.activeDoc?.id===initialDocId) engine.setProofSettings(settings)
    useEditorStore.getState().pushToast('Proof setup: '+profileLabel,'success')
    onClose()
  }

  if(!doc) return (
    <>
      <DialogHeader><DialogTitle>Proof Setup</DialogTitle></DialogHeader>
      <div className="py-4 text-xs text-muted-foreground">Open a document first.</div>
      <DialogFooter><Button size="sm" onClick={onClose}>Close</Button></DialogFooter>
    </>
  )

  return (
    <>
      <DialogHeader><DialogTitle>Proof Setup</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[10px] leading-relaxed text-muted-foreground">
          Soft proofing changes viewport display only. Layer pixels, History, sampling and exports remain unmodified.
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">Device to Simulate</Label>
          <Select value={settings.profile} onValueChange={v=>patch('profile',v as ProofProfileId)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              {(Object.keys(PROFILE_LABELS) as ProofProfileId[]).map(id=>(
                <SelectItem key={id} value={id} className="text-xs">{PROFILE_LABELS[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {settings.profile==='custom-rgb' && (
          <div className="rounded border border-border p-2 space-y-2">
            <div className="text-[10px] text-muted-foreground">
              {settings.customMatrix ? 'Loaded: '+(settings.customProfileName||'Custom RGB ICC') : 'No custom RGB ICC loaded.'}
            </div>
            <Button size="sm" variant="secondary" onClick={importIcc}>Load ICC / ICM…</Button>
            {iccMessage && <div className="text-[10px] text-muted-foreground leading-relaxed">{iccMessage}</div>}
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-[11px]">Rendering Intent</Label>
          <Select value={settings.intent} onValueChange={v=>patch('intent',v as ProofSettings['intent'])}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              <SelectItem value="perceptual" className="text-xs">Perceptual</SelectItem>
              <SelectItem value="relative" className="text-xs">Relative Colorimetric</SelectItem>
              <SelectItem value="saturation" className="text-xs">Saturation</SelectItem>
              <SelectItem value="absolute" className="text-xs">Absolute Colorimetric</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded border border-border/60 p-2 space-y-2">
          <CheckRow label="Preview Proof Colors" checked={settings.enabled} onChange={v=>patch('enabled',v)} />
          <CheckRow label="Black Point Compensation" checked={settings.blackPointCompensation} onChange={v=>patch('blackPointCompensation',v)} />
          <CheckRow label="Simulate Paper Color" checked={settings.simulatePaperColor} onChange={v=>patch('simulatePaperColor',v)} />
          <CheckRow label="Gamut Warning" checked={settings.gamutWarning} onChange={v=>patch('gamutWarning',v)} />
        </div>

        <div className="text-[10px] leading-relaxed text-muted-foreground">
          Built-in RGB proofs use matrix gamut conversion. The SWOP and Gray presets are display simulations, not substitutes for a full LUT-based press ICC engine. Custom ICC proofing currently accepts matrix RGB profiles and performs D65↔D50 chromatic adaptation.
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={apply}>OK</Button>
      </DialogFooter>
    </>
  )
}
