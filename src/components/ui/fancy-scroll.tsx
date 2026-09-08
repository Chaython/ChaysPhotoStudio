'use client'
// FancyScroll — stylized auto-hiding overlay scrollbar (Chay's Photo Studio).
//
// Drop-in replacement for `<div className="… overflow-y-auto zphoto-scroll">`:
//   <FancyScroll className="flex-1 min-h-0" role="list" aria-label="Layers">
//     {children}
//   </FancyScroll>
//
// - `className`         → outer wrapper (sizing / flex participation, e.g. "flex-1 min-h-0" or "h-full")
// - `contentClassName`  → the native scroll element (content layout, e.g. "p-2 grid grid-cols-2")
//
// The native scrollbar is hidden; a custom amber overlay scrollbar (thumb +
// arrow buttons) fades in on scroll / hover and AUTO-HIDES:
//   · after ~1s with no scrolling — even while the pointer is still over the
//     content (macOS overlay-scrollbar behavior), and
//   · ~350ms after the pointer leaves the container.
// Hovering the scrollbar strip itself (thumb / track / arrows) keeps it
// alive so it can always be grabbed. The overlay has NO track background
// (fully transparent — only the thumb and the arrow glyphs render) and it
// is pointer-inert while faded, so it never steals clicks from the content.
// Thumb geometry is updated via direct DOM mutation on scroll (no re-render);
// state updates are guarded so children never re-render on scroll.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const SCROLL_IDLE = 1000    // ms after the last scroll event before fading (even while hovering content)
const HOVER_IDLE = 1600     // ms after entering the content before fading (a polite "peek")
const LEAVE_DELAY = 350     // ms after the pointer leaves the container
const STRIP_LEAVE = 450     // ms after the pointer leaves the scrollbar strip
const MIN_THUMB = 28        // px — minimum thumb height
const STEP = 90             // px — arrow click scroll step

interface FancyScrollProps {
  className?: string
  contentClassName?: string
  style?: CSSProperties
  role?: string
  'aria-label'?: string
  children?: ReactNode
  /** vertical (default) renders the custom overlay; horizontal falls back to native */
  orientation?: 'vertical' | 'horizontal'
}

interface DragState {
  pointerId: number
  startClientY: number
  startScrollTop: number
}

export function FancyScroll({
  className,
  contentClassName,
  style,
  role,
  'aria-label': ariaLabel,
  children,
  orientation = 'vertical',
}: FancyScrollProps) {
  const scrollerId = useId()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)
  const arrowTimer = useRef<number | null>(null)
  const stripHoverRef = useRef(false)
  const draggingRef = useRef<DragState | null>(null)

  const [visible, setVisible] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [edges, setEdges] = useState({ top: true, bottom: false })

  const clearHideTimer = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  /** schedule the fade-out — cancelled by any new activity;
   *  hovering the scrollbar strip or dragging the thumb keeps it alive */
  const scheduleHide = useCallback((delay: number) => {
    clearHideTimer()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      if (!stripHoverRef.current && !draggingRef.current) setVisible(false)
    }, delay)
  }, [])

  /** show the overlay + reset the idle timer */
  const wake = useCallback((delay: number) => {
    setVisible(true)
    if (!stripHoverRef.current && !draggingRef.current) scheduleHide(delay)
  }, [scheduleHide])

  /** recompute thumb geometry (direct DOM mutation — no re-render) + edge state */
  const updateThumb = useCallback(() => {
    const sc = scrollerRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!sc) return
    const overflow = sc.scrollHeight > sc.clientHeight + 2
    setHasOverflow(prev => (prev === overflow ? prev : overflow))
    const top = sc.scrollTop <= 0
    const bottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1
    setEdges(prev => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
    if (!track || !thumb || !overflow) return
    const trackH = track.clientHeight
    const maxScroll = sc.scrollHeight - sc.clientHeight
    const thumbH = Math.max(MIN_THUMB, Math.min(trackH, (sc.clientHeight / sc.scrollHeight) * trackH))
    const free = Math.max(0, trackH - thumbH)
    const ratio = maxScroll > 0 ? sc.scrollTop / maxScroll : 0
    thumb.style.height = `${thumbH}px`
    thumb.style.top = `${ratio * free}px`
    // keep the ARIA slider semantics in sync (direct DOM — no re-render)
    thumb.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
  }, [])

  const measure = useCallback(() => {
    updateThumb()
  }, [updateThumb])

  // re-measure after every render (content changes) + observe container resizes
  useEffect(() => {
    measure()
  })
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(sc)
    return () => ro.disconnect()
  }, [measure])
  useEffect(() => {
    if (orientation !== 'vertical') return
    const sc = scrollerRef.current
    if (!sc) return
    const onWinResize = () => measure()
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [measure, orientation])

  // cleanup timers on unmount
  useEffect(() => () => {
    clearHideTimer()
    if (arrowTimer.current !== null) window.clearInterval(arrowTimer.current)
  }, [])

  // ---- native scroll events -------------------------------------------------
  const onScroll = useCallback(() => {
    updateThumb()
    wake(SCROLL_IDLE)
  }, [updateThumb, wake])

  // ---- container hover: peek, then auto-hide while still hovering ----------
  const onPointerEnter = useCallback(() => {
    wake(HOVER_IDLE)
  }, [wake])
  const onPointerLeave = useCallback(() => {
    scheduleHide(LEAVE_DELAY)
  }, [scheduleHide])

  // ---- scrollbar strip hover: keeps the overlay alive ----------------------
  const onStripPointerEnter = useCallback(() => {
    stripHoverRef.current = true
    clearHideTimer()
    setVisible(true)
  }, [])
  const onStripPointerLeave = useCallback(() => {
    stripHoverRef.current = false
    scheduleHide(STRIP_LEAVE)
  }, [scheduleHide])

  // ---- thumb drag ------------------------------------------------------------
  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const sc = scrollerRef.current
    if (!sc) return
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = { pointerId: e.pointerId, startClientY: e.clientY, startScrollTop: sc.scrollTop }
    e.currentTarget.setPointerCapture(e.pointerId)
    clearHideTimer()
    setVisible(true)
  }
  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingRef.current
    const sc = scrollerRef.current
    const track = trackRef.current
    if (!drag || drag.pointerId !== e.pointerId || !sc || !track) return
    const trackH = track.clientHeight
    const thumbH = Math.max(MIN_THUMB, Math.min(trackH, (sc.clientHeight / sc.scrollHeight) * trackH))
    const free = Math.max(0, trackH - thumbH)
    const maxScroll = sc.scrollHeight - sc.clientHeight
    if (maxScroll <= 0 || free <= 0) return
    const dy = e.clientY - drag.startClientY
    sc.scrollTop = Math.max(0, Math.min(maxScroll, drag.startScrollTop + (dy / free) * maxScroll))
    updateThumb()
  }
  const onThumbPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current?.pointerId !== e.pointerId) return
    draggingRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    scheduleHide(HOVER_IDLE)
  }

  // ---- track click = page up/down (like native) -------------------------------
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const sc = scrollerRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!sc || !track || !thumb) return
    e.preventDefault()
    e.stopPropagation()
    track.setPointerCapture(e.pointerId)
    wake(SCROLL_IDLE)
    const trackTop = track.getBoundingClientRect().top
    const y = e.clientY - trackTop
    const thumbTop = thumb.offsetTop
    const thumbH = thumb.offsetHeight
    if (y >= thumbTop && y <= thumbTop + thumbH) return // clicked on the thumb
    const dir = y < thumbTop ? -1 : 1
    sc.scrollBy({ top: dir * sc.clientHeight * 0.9, behavior: 'smooth' })
  }

  // ---- arrow buttons: click = 90px smooth, hold = repeat every 110ms ----------
  const scrollStep = useCallback((dir: number, smooth: boolean) => {
    const sc = scrollerRef.current
    if (!sc) return
    sc.scrollBy({ top: dir * STEP, behavior: smooth ? 'smooth' : 'auto' })
    wake(SCROLL_IDLE)
  }, [wake])

  const startArrowRepeat = (e: React.PointerEvent<HTMLButtonElement>, dir: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (arrowTimer.current !== null) window.clearInterval(arrowTimer.current)
    scrollStep(dir, true)
    arrowTimer.current = window.setInterval(() => scrollStep(dir, false), 110)
  }
  const stopArrowRepeat = () => {
    if (arrowTimer.current !== null) {
      window.clearInterval(arrowTimer.current)
      arrowTimer.current = null
    }
  }
  // keyboard activation (Enter/Space) — e.detail === 0 means keyboard-triggered click
  const onArrowClick = (e: React.MouseEvent<HTMLButtonElement>, dir: number) => {
    if (e.detail !== 0) return
    scrollStep(dir, true)
  }

  if (orientation !== 'vertical') {
    // horizontal or auto: plain native scroller (zphoto-scroll auto-hide styling)
    return (
      <div className={cn('relative min-h-0 overflow-hidden', className)} style={style}>
        <div ref={scrollerRef} className={cn('h-full w-full overflow-x-auto zphoto-scroll', contentClassName)}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('relative min-h-0 overflow-hidden', className)}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {/* native scroll container (native scrollbar hidden) */}
      <div
        ref={scrollerRef}
        id={scrollerId}
        className={cn('h-full w-full overflow-y-auto no-native-scroll', contentClassName)}
        role={role}
        aria-label={ariaLabel}
        onScroll={onScroll}
      >
        {children}
      </div>

      {/* overlay scrollbar — transparent background, pointer-inert while faded */}
      {hasOverflow && (
        <div
          className={cn(
            'absolute inset-0 z-10 pointer-events-none transition-opacity duration-200 ease-out',
            visible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/* the strip: interactive ONLY while visible (never steals content clicks) */}
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 w-3.5 flex flex-col items-stretch',
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            )}
            onPointerEnter={onStripPointerEnter}
            onPointerLeave={onStripPointerLeave}
          >
            {/* up arrow */}
            <button
              type="button"
              aria-label="Scroll up"
              disabled={edges.top}
              className={cn(
                'h-6 flex items-center justify-center rounded-sm text-muted-foreground',
                'hover:text-primary hover:bg-primary/10 transition-colors',
                'disabled:opacity-30 disabled:pointer-events-none'
              )}
              onPointerDown={e => startArrowRepeat(e, -1)}
              onPointerUp={stopArrowRepeat}
              onPointerLeave={stopArrowRepeat}
              onPointerCancel={stopArrowRepeat}
              onClick={e => onArrowClick(e, -1)}
            >
              <ChevronUp size={11} />
            </button>

            {/* track — no background line, fully transparent */}
            <div
              ref={trackRef}
              className="flex-1 relative"
              onPointerDown={onTrackPointerDown}
            >
              {/* thumb */}
              <div
                ref={thumbRef}
                role="scrollbar"
                aria-orientation="vertical"
                aria-label="Scroll"
                aria-controls={scrollerId}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={0}
                className={cn(
                  'absolute left-1/2 -ml-[3px] w-[5px] rounded-full bg-primary/70',
                  'hover:bg-primary active:bg-primary cursor-default',
                  'transition-transform duration-200 ease-out',
                  visible ? 'translate-x-0' : 'translate-x-[3px]'
                )}
                style={{ top: 0, height: MIN_THUMB }}
                onPointerDown={onThumbPointerDown}
                onPointerMove={onThumbPointerMove}
                onPointerUp={onThumbPointerEnd}
                onPointerCancel={onThumbPointerEnd}
              />
            </div>

            {/* down arrow */}
            <button
              type="button"
              aria-label="Scroll down"
              disabled={edges.bottom}
              className={cn(
                'h-6 flex items-center justify-center rounded-sm text-muted-foreground',
                'hover:text-primary hover:bg-primary/10 transition-colors',
                'disabled:opacity-30 disabled:pointer-events-none'
              )}
              onPointerDown={e => startArrowRepeat(e, 1)}
              onPointerUp={stopArrowRepeat}
              onPointerLeave={stopArrowRepeat}
              onPointerCancel={stopArrowRepeat}
              onClick={e => onArrowClick(e, 1)}
            >
              <ChevronDown size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default FancyScroll
