'use client'
import { useMemo, useState } from 'react'
import { CircleHelp, ExternalLink, Search } from 'lucide-react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { HELP_CATEGORIES, HELP_TOPICS, getHelpTopic, searchHelpTopics, type HelpCategory } from '../../help/topics'
import type { DialogProps } from './generic-dialogs'

export function HelpGuideDialog({ inst, onClose }: DialogProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<HelpCategory | 'All'>('All')
  const [activeId, setActiveId] = useState(() => getHelpTopic(inst.props?.topic)?.id ?? HELP_TOPICS[0]?.id ?? '')
  const results = useMemo(() => searchHelpTopics(query, category), [query, category])
  const active = results.find(t => t.id === activeId) ?? results[0] ?? null
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><CircleHelp className="text-primary" size={18}/> Help & User Guide</DialogTitle>
        <p className="text-xs text-muted-foreground">Search editing tools and step-by-step instructions. Available offline.</p>
      </DialogHeader>
      <div className="min-h-0 space-y-3">
        <label className="relative flex items-center">
          <Search className="absolute left-3 text-muted-foreground pointer-events-none" size={15}/>
          <Input type="search" aria-label="Search help topics" placeholder="Search tools, menus and techniques…"
            className="h-9 pl-9 text-sm" value={query} onChange={e => setQuery(e.target.value)}/>
        </label>
        <div className="flex gap-1 overflow-x-auto zphoto-scroll pb-1" aria-label="Help category">
          {(['All', ...HELP_CATEGORIES] as const).map(c => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
              className={`shrink-0 border rounded px-2 py-1 text-[11px] transition-colors ${category === c
                ? 'border-primary/50 text-primary bg-primary/15'
                : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40'}`}>{c}</button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row min-h-0 gap-3">
          <nav aria-label="Help topics" className="sm:w-[36%] sm:shrink-0 max-h-40 sm:max-h-[53vh] overflow-y-auto zphoto-scroll border rounded-md border-border/60 p-1">
            {results.length ? results.map(t => (
              <button key={t.id} type="button" onClick={() => setActiveId(t.id)}
                aria-current={active?.id === t.id ? 'page' : undefined}
                className={`block text-left w-full p-2 rounded mb-0.5 ${active?.id === t.id
                  ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                <span className="block text-xs font-medium">{t.title}</span>
                <span className="block text-[10px] opacity-75 mt-0.5">{t.category}</span>
              </button>
            )) : <p className="p-3 text-xs text-muted-foreground">No matching topics. Try another search or select All.</p>}
          </nav>
          <article key={active?.id ?? 'none'} aria-label={active?.title ?? 'Help topic'}
            className="min-w-0 flex-1 max-h-[48vh] sm:max-h-[53vh] overflow-y-auto zphoto-scroll rounded-md border border-border/60 p-3 sm:p-4">
            {active ? (
              <div className="text-xs space-y-3 leading-relaxed">
                <div className="space-y-1">
                  <p className="uppercase tracking-wider text-primary text-[10px]">{active.category}</p>
                  <h3 className="text-base font-semibold text-foreground">{active.title}</h3>
                  <p className="text-muted-foreground">{active.summary}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Where to find it</p>
                  <p className="font-medium text-foreground">{active.path}</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1.5">How to use</h4>
                  <ol className="list-decimal pl-5 space-y-1.5">{active.steps.map((s,i)=><li key={i}>{s}</li>)}</ol>
                </div>
                {!!active.tips.length && <div>
                  <h4 className="font-semibold mb-1.5">Notes and tips</h4>
                  <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">{active.tips.map((s,i)=><li key={i}>{s}</li>)}</ul>
                </div>}
              </div>
            ) : <p className="text-muted-foreground text-xs">Select a help topic to see instructions.</p>}
          </article>
        </div>
      </div>
      <DialogFooter className="sm:justify-between gap-2">
        <a href="https://github.com/Chaython/ChaysPhotoStudio/blob/main/docs/USER_GUIDE.md"
          target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Full manual on GitHub <ExternalLink size={12}/>
        </a>
        <Button size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}
