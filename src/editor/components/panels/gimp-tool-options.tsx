'use client'
// GIMP-style Tool Options panel
// Replicates GIMP 3.0's tool options dock with accordion sections

import { useMemo } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { useEditorStore } from '../../store'
import { TOOL_MAP } from '../../constants/tools'
import type { ToolId } from '../../types'
import { cn } from '@/lib/utils'
import { ChevronDown, SlidersHorizontal, Brush, Move, Lasso, Wand2, Crop, Pipette, Paintbrush, Eraser, Stamp, Bandage, Blend, PaintBucket, Type, PenTool, Shapes, Hand, ZoomIn, Scissors, User, SprayCan, Pen, Grid, Waves, RotateCcw, Maximize2, Slash, Box, Move3d, CornerUpLeft, FlipHorizontal2 } from 'lucide-react'

// Tool option sections organized like GIMP
const TOOL_OPTION_SECTIONS: Record<string, { label: string; icon: any; keys: string[] }> = {
  brush: { label: 'Brush', icon: Brush, keys: ['size', 'hardness', 'opacity', 'flow', 'spacing', 'blendMode', 'tip', 'angle', 'roundness', 'symmetry', 'mandalaCount', 'pressureSize', 'pressureOpacity', 'pressureFlow'] },
  pencil: { label: 'Brush', icon: Brush, keys: ['size', 'opacity', 'spacing', 'blendMode', 'autoErase', 'pressureFlow', 'pressureSize'] },
  'mixer-brush': { label: 'Brush', icon: Brush, keys: ['size', 'hardness', 'wet', 'load', 'mix', 'flow', 'spacing', 'sampleAllLayers', 'tip', 'angle', 'roundness', 'bristle', 'bristleCount', 'bristleLength', 'bristleStiffness', 'autoClean'] },
  'color-replacement': { label: 'Brush', icon: Brush, keys: ['size', 'hardness', 'spacing', 'mode', 'tolerance', 'perceptual', 'opacity', 'sampling', 'limits', 'pressureSize'] },
  eraser: { label: 'Brush', icon: Eraser, keys: ['mode', 'size', 'hardness', 'opacity', 'flow', 'spacing', 'tip', 'angle', 'roundness', 'eraseToHistory', 'pressure', 'pressureSize'] },
  'background-eraser': { label: 'Brush', icon: Eraser, keys: ['size', 'hardness', 'spacing', 'tolerance', 'sampling', 'limits', 'protectForeground', 'decontaminate', 'pressureSize'] },
  'magic-eraser': { label: 'Brush', icon: Wand2, keys: ['tolerance', 'opacity', 'contiguous', 'antiAlias', 'sampleAllLayers', 'sampleRadius', 'edgeAware', 'decontaminate', 'exactPixels', 'output'] },
  airbrush: { label: 'Brush', icon: SprayCan, keys: ['size', 'hardness', 'opacity', 'flow', 'spacing', 'rate', 'pressure', 'tip', 'angle', 'roundness'] },
  ink: { label: 'Brush', icon: Pen, keys: ['size', 'angle', 'sensitivity', 'tilt', 'pressureSize', 'pressureAngle'] },
  'mypaint-brush': { label: 'Brush', icon: Brush, keys: ['radius', 'hardness', 'opacity', 'speed', 'e', 'random'] },
  'clone-stamp': { label: 'Clone', icon: Stamp, keys: ['sourceSlot', 'size', 'hardness', 'opacity', 'flow', 'spacing', 'blendMode', 'brushAngle', 'brushRoundness', 'pressureSize', 'pressureOpacity', 'sample', 'showOverlay', 'overlayOpacity', 'overlayAutoHide', 'overlayClipped', 'overlayBlend', 'overlayInvert'] },
  'pattern-stamp': { label: 'Pattern', icon: Stamp, keys: ['size', 'hardness', 'blendMode', 'pattern', 'patternScale', 'patternOffsetX', 'patternOffsetY', 'aligned', 'impressionist', 'impressionistStroke', 'impressionistScatter', 'pressureFlow', 'pressureSize'] },
  'healing-brush': { label: 'Heal', icon: Bandage, keys: ['size', 'hardness', 'opacity', 'flow', 'spacing', 'blendMode', 'brushAngle', 'brushRoundness', 'pressureSize', 'source', 'sample', 'ignoreAdjustments', 'pattern', 'patternScale', 'patternOffsetX', 'patternOffsetY', 'aligned', 'diffusion'] },
  'spot-healing': { label: 'Heal', icon: Bandage, keys: ['size', 'hardness', 'spacing', 'angle', 'roundness', 'type', 'provider', 'structure', 'color', 'sampleAllLayers', 'output'] },
  remove: { label: 'Remove', icon: Eraser, keys: ['size', 'hardness', 'spacing', 'expand', 'feather', 'sampleAllLayers'] },
  patch: { label: 'Patch', icon: Bandage, keys: ['mode', 'direction', 'heal', 'transparent', 'structure', 'color', 'pattern', 'patternScale', 'patternOffsetX', 'patternOffsetY', 'diffusion', 'sampleAllLayers'] },
  'content-aware-move': { label: 'Move', icon: Move3d, keys: ['mode', 'structure', 'color', 'sampleAllLayers', 'transformOnDrop', 'output'] },
  blur: { label: 'Blur/Sharpen', icon: Slash, keys: ['size', 'hardness', 'strength', 'protectEdges', 'edgeThreshold', 'pressure', 'sampleAllLayers', 'output', 'tip', 'angle', 'roundness'] },
  sharpen: { label: 'Blur/Sharpen', icon: Slash, keys: ['size', 'hardness', 'strength', 'threshold', 'protectDetail', 'reduceNoise', 'pressure', 'sampleAllLayers', 'output', 'tip', 'angle', 'roundness'] },
  smudge: { label: 'Smudge', icon: Waves, keys: ['size', 'hardness', 'strength', 'sampleAllLayers', 'fingerPainting', 'pressureStrength', 'pressureSize', 'output', 'tip', 'angle', 'roundness'] },
  dodge: { label: 'Dodge/Burn', icon: Slash, keys: ['size', 'hardness', 'exposure', 'range', 'protectTones', 'pressure', 'airbrush', 'tip', 'angle', 'roundness'] },
  burn: { label: 'Dodge/Burn', icon: Slash, keys: ['size', 'hardness', 'exposure', 'range', 'protectTones', 'pressure', 'airbrush', 'tip', 'angle', 'roundness'] },
  sponge: { label: 'Sponge', icon: Waves, keys: ['size', 'hardness', 'flow', 'mode', 'vibrance', 'pressure', 'airbrush', 'tip', 'angle', 'roundness'] },
  gradient: { label: 'Gradient', icon: Blend, keys: ['mode', 'type', 'stops', 'interpolation', 'smoothness', 'noise', 'noiseSeed', 'reverse', 'opacity', 'blendMode', 'transparency', 'dither'] },
  'paint-bucket': { label: 'Fill', icon: PaintBucket, keys: ['tolerance', 'perceptual', 'contiguous', 'diagonal', 'smooth', 'antiAlias', 'fill', 'pattern', 'patternScale', 'patternOffsetX', 'patternOffsetY', 'opacity', 'blendMode', 'sample'] },
  text: { label: 'Text', icon: Type, keys: ['mode', 'direction', 'kerning', 'ligatures', 'smallCaps', 'fontStretch', 'fontWeight', 'size', 'family', 'color', 'bold', 'italic', 'underline', 'strikethrough', 'align', 'lineHeight', 'tracking', 'wordSpacing', 'baselineShift', 'boxWidth', 'boxHeight', 'warpStyle', 'warpBend', 'warpHorizontal', 'warpVertical'] },
  move: { label: 'Move', icon: Move, keys: ['autoSelect', 'showTransformControls', 'smartGuides', 'showDistances', 'unit', 'useDocResolution', 'pixelsPerUnit', 'alignTo'] },
  'alignment': { label: 'Alignment', icon: Move, keys: ['alignTo', 'relativeTo', 'offsetX', 'offsetY'] },
  rotate: { label: 'Rotate', icon: RotateCcw, keys: ['angle', 'centerX', 'centerY', 'interpolation', 'clipping'] },
  scale: { label: 'Scale', icon: Maximize2, keys: ['width', 'height', 'link', 'interpolation', 'clipping'] },
  shear: { label: 'Shear', icon: Slash, keys: ['angleX', 'angleY', 'interpolation', 'clipping'] },
  perspective: { label: 'Perspective', icon: Box, keys: ['interpolation', 'clipping'] },
  'unified-transform': { label: 'Transform', icon: Move3d, keys: ['transform', 'angle', 'scaleX', 'scaleY', 'shearX', 'shearY', 'perspectiveX', 'perspectiveY', 'centerX', 'centerY', 'interpolation', 'clipping'] },
  'handle-transform': { label: 'Handles', icon: CornerUpLeft, keys: ['handles', 'interpolation', 'clipping'] },
  flip: { label: 'Flip', icon: FlipHorizontal2, keys: ['direction', 'centerX', 'centerY'] },
  'cage-transform': { label: 'Cage', icon: Grid, keys: ['rows', 'cols', 'interpolation', 'clipping'] },
  'warp-transform': { label: 'Warp', icon: Waves, keys: ['gridSize', 'interpolation', 'clipping'] },
  'marquee-rect': { label: 'Selection', icon: Move, keys: ['mode', 'feather', 'antiAlias', 'style', 'ratioW', 'ratioH', 'fixedW', 'fixedH', 'transformSelection', 'transformPivotX', 'transformPivotY', 'selectMask'] },
  'marquee-ellipse': { label: 'Selection', icon: Move, keys: ['mode', 'feather', 'antiAlias', 'style', 'ratioW', 'ratioH', 'fixedW', 'fixedH', 'transformSelection', 'transformPivotX', 'transformPivotY', 'selectMask'] },
  lasso: { label: 'Selection', icon: Lasso, keys: ['mode', 'feather', 'antiAlias', 'smoothing', 'selectMask'] },
  'polygon-lasso': { label: 'Selection', icon: Lasso, keys: ['mode', 'feather', 'antiAlias', 'angleSnap', 'selectMask'] },
  'magnetic-lasso': { label: 'Selection', icon: Lasso, keys: ['mode', 'width', 'contrast', 'frequency', 'sample', 'feather', 'antiAlias', 'selectMask'] },
  'selection-brush': { label: 'Selection', icon: Brush, keys: ['brushMode', 'size', 'hardness', 'opacity', 'overlayColor', 'overlayOpacity', 'selectMask'] },
  'quick-mask': { label: 'Selection', icon: Brush, keys: ['brushMode', 'size', 'hardness', 'opacity', 'overlayColor', 'overlayOpacity', 'selectMask'] },
  'object-select': { label: 'Selection', icon: Move, keys: ['mode', 'geometry', 'clickSearch', 'sample', 'detector', 'level', 'feather', 'antiAlias', 'selectMask'] },
  'quick-select': { label: 'Selection', icon: Wand2, keys: ['mode', 'size', 'tolerance', 'sample', 'autoEnhance', 'refineProvider', 'feather', 'selectMask'] },
  'magic-wand': { label: 'Selection', icon: Wand2, keys: ['mode', 'tolerance', 'sampleRadius', 'edgeAware', 'adaptive', 'contiguous', 'diagonal', 'sample', 'matchAlpha', 'smooth', 'feather', 'antiAlias', 'selectMask', 'exactPixels'] },
  'scissors-select': { label: 'Selection', icon: Scissors, keys: ['mode', 'feather', 'antiAlias', 'interactive', 'selectMask'] },
  'foreground-select': { label: 'Selection', icon: User, keys: ['mode', 'feather', 'drawForeground', 'drawBackground', 'strokeWidth', 'previewColor', 'selectMask'] },
  crop: { label: 'Crop', icon: Crop, keys: ['straighten', 'ratio', 'ratioW', 'ratioH', 'targetWidth', 'targetHeight', 'resolutionPpi', 'overlay', 'deletePixels'] },
  'perspective-crop': { label: 'Crop', icon: Crop, keys: ['output', 'targetWidth', 'targetHeight', 'resolutionPpi', 'grid'] },
  eyedropper: { label: 'Color', icon: Pipette, keys: ['sample', 'radius', 'hud'] },
  'color-sampler': { label: 'Color', icon: Pipette, keys: ['sample', 'radius', 'showLabels'] },
  measure: { label: 'Measure', icon: SlidersHorizontal, keys: ['chain', 'angleSnap', 'unit', 'useDocResolution', 'pixelsPerUnit', 'showDelta', 'persist', 'measureActions'] },
}

export function GimpToolOptionsPanel() {
  const activeTool = useEditorStore(s => s.activeTool)
  const toolOptions = useEditorStore(s => s.toolOptions)
  const setToolOption = useEditorStore(s => s.setToolOption)

  const toolDef = TOOL_MAP[activeTool as ToolId]
  if (!toolDef) return null

  const sections = TOOL_OPTION_SECTIONS[activeTool]
  const allOptions = toolDef.options || []
  const optionMap = new Map(allOptions.map(o => [o.key, o]))

  // Get relevant options for this tool
  const relevantOptions = sections
    ? allOptions.filter(o => sections.keys.includes(o.key))
    : allOptions

  // Group options by section (simplified - could be enhanced)
  const optionGroups = useMemo(() => {
    const groups: Record<string, typeof allOptions> = {}
    for (const opt of relevantOptions) {
      const group = getOptionGroup(opt.key)
      if (!groups[group]) groups[group] = []
      groups[group].push(opt)
    }
    return groups
  }, [relevantOptions])

  return (
    <div className="space-y-2 p-1.5">
      <div className="flex items-center gap-2 px-1 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border/40">
        <span className="flex-1">{toolDef.label} Options</span>
        <SlidersHorizontal size={12} className="text-primary" />
      </div>

      <div className="space-y-1.5 max-h-[500px] overflow-y-auto zphoto-scroll pr-1">
        {Object.entries(optionGroups).map(([groupName, options]) => (
          <Collapsible key={groupName} defaultOpen>
            <CollapsibleTrigger asChild className="w-full">
              <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm text-xs font-medium text-foreground hover:bg-accent/50 transition-colors">
                <ChevronDown size={10} className="text-muted-foreground" />
                {groupName}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-1 pb-1.5 px-1">
              {options.map(opt => (
                <ControlRenderer
                  key={opt.key}
                  def={opt}
                  value={toolOptions[activeTool as ToolId]?.[opt.key] ?? opt.defaults?.[opt.key]}
                  onChange={(value) => setToolOption(activeTool as ToolId, opt.key, value)}
                  compact
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}

        {/* Advanced section for remaining options */}
        {relevantOptions.length > Object.keys(optionGroups).reduce((sum, k) => sum + optionGroups[k].length, 0) && (
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild className="w-full">
              <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm text-xs font-medium text-muted-foreground hover:bg-accent/50 transition-colors">
                <ChevronDown size={10} className="text-muted-foreground" />
                Advanced
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-1 pb-1.5 px-1">
              {relevantOptions
                .filter(opt => !optionGroups[getOptionGroup(opt.key)]?.some(o => o.key === opt.key))
                .map(opt => (
                  <ControlRenderer
                    key={opt.key}
                    def={opt}
                    value={toolOptions[activeTool as ToolId]?.[opt.key] ?? opt.defaults?.[opt.key]}
                    onChange={(value) => setToolOption(activeTool as ToolId, opt.key, value)}
                    compact
                  />
                ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}

function getOptionGroup(key: string): string {
  const groupMap: Record<string, string> = {
    // Brush groups
    size: 'Brush',
    hardness: 'Brush',
    opacity: 'Brush',
    flow: 'Brush',
    spacing: 'Brush',
    blendMode: 'Brush',
    tip: 'Brush',
    angle: 'Brush',
    roundness: 'Brush',
    symmetry: 'Brush',
    mandalaCount: 'Brush',
    pressureSize: 'Dynamics',
    pressureOpacity: 'Dynamics',
    pressureFlow: 'Dynamics',
    sizeJitter: 'Dynamics',
    minDiameter: 'Dynamics',
    angleJitter: 'Dynamics',
    roundnessJitter: 'Dynamics',
    minRoundness: 'Dynamics',
    opacityJitter: 'Dynamics',
    flowJitter: 'Dynamics',
    scatter: 'Dynamics',
    scatterBothAxes: 'Dynamics',
    count: 'Dynamics',
    countJitter: 'Dynamics',
    fade: 'Dynamics',
    airbrush: 'Dynamics',
    dynamics: 'Dynamics',
    stampId: 'Dynamics',
    textureEnabled: 'Texture',
    texture: 'Texture',
    textureScale: 'Texture',
    textureDepth: 'Texture',
    textureInvert: 'Texture',
    dualBrush: 'Dual Brush',
    dualTip: 'Dual Brush',
    dualSize: 'Dual Brush',
    dualAngle: 'Dual Brush',
    wet: 'Mixer',
    load: 'Mixer',
    mix: 'Mixer',
    sampleAllLayers: 'Mixer',
    bristle: 'Bristles',
    bristleCount: 'Bristles',
    bristleLength: 'Bristles',
    bristleStiffness: 'Bristles',
    tiltBristles: 'Bristles',
    twistBristles: 'Bristles',
    autoClean: 'Bristles',
    mode: 'Options',
    eraseToHistory: 'Options',
    autoErase: 'Options',
    smoothing: 'Options',
    rate: 'Options',
    sensitivity: 'Options',
    tilt: 'Options',
    pressureAngle: 'Options',
    radius: 'Options',
    speed: 'Options',
    e: 'Options',
    random: 'Options',
    sourceSlot: 'Clone Source',
    brushAngle: 'Brush Shape',
    brushRoundness: 'Brush Shape',
    showOverlay: 'Overlay',
    overlayOpacity: 'Overlay',
    overlayAutoHide: 'Overlay',
    overlayClipped: 'Overlay',
    overlayBlend: 'Overlay',
    overlayInvert: 'Overlay',
    source: 'Source',
    sample: 'Source',
    ignoreAdjustments: 'Source',
    pattern: 'Pattern',
    patternScale: 'Pattern',
    patternOffsetX: 'Pattern',
    patternOffsetY: 'Pattern',
    aligned: 'Pattern',
    diffusion: 'Healing',
    brushMode: 'Mode',
    overlayColor: 'Overlay',
    overlayOpacity: 'Overlay',
    geometry: 'Mode',
    clickSearch: 'Mode',
    detector: 'Mode',
    level: 'Refine',
    autoEnhance: 'Edge',
    refineProvider: 'Refine',
    exactPixels: 'Matching',
    matchAlpha: 'Matching',
    contiguous: 'Fill',
    diagonal: 'Fill',
    perceptual: 'Color',
    smooth: 'Edge',
    antiAlias: 'Edge',
    fill: 'Fill',
    pattern: 'Pattern',
    patternScale: 'Pattern',
    patternOffsetX: 'Pattern',
    patternOffsetY: 'Pattern',
    straighten: 'Crop',
    ratio: 'Crop',
    ratioW: 'Crop',
    ratioH: 'Crop',
    targetWidth: 'Crop',
    targetHeight: 'Crop',
    resolutionPpi: 'Crop',
    overlay: 'Overlay',
    deletePixels: 'Crop',
    output: 'Output',
    angle: 'Transform',
    centerX: 'Transform',
    centerY: 'Transform',
    interpolation: 'Quality',
    clipping: 'Clipping',
    width: 'Scale',
    height: 'Scale',
    link: 'Scale',
    angleX: 'Shear',
    angleY: 'Shear',
    transform: 'Transform',
    scaleX: 'Scale',
    scaleY: 'Scale',
    shearX: 'Shear',
    shearY: 'Shear',
    perspectiveX: 'Perspective',
    perspectiveY: 'Perspective',
    handles: 'Handles',
    direction: 'Flip',
    rows: 'Cage',
    cols: 'Cage',
    gridSize: 'Warp',
    style: 'Style',
    fixedW: 'Size',
    fixedH: 'Size',
    transformSelection: 'Transform',
    transformPivotX: 'Pivot',
    transformPivotY: 'Pivot',
    selectMask: 'Refine',
    sizing: 'Sizing',
    brushMode: 'Mode',
    drawForeground: 'Mode',
    drawBackground: 'Mode',
    strokeWidth: 'Stroke',
    previewColor: 'Preview',
    interactive: 'Mode',
    expand: 'Mask',
    feather: 'Mask',
    alignTo: 'Align',
    autoSelect: 'Auto',
    showTransformControls: 'Transform',
    smartGuides: 'Guides',
    showDistances: 'Distances',
    unit: 'Units',
    useDocResolution: 'Resolution',
    pixelsPerUnit: 'Units',
    relativeTo: 'Align',
    offsetX: 'Offset',
    offsetY: 'Offset',
    chain: 'Chain',
    angleSnap: 'Snap',
    useDocResolution: 'Resolution',
    pixelsPerUnit: 'Units',
    showDelta: 'Delta',
    persist: 'Persist',
    measureActions: 'Actions',
    radius: 'Sample',
    hud: 'HUD',
    showLabels: 'Labels',
    pressure: 'Pressure',
    strength: 'Strength',
    protectEdges: 'Edges',
    edgeThreshold: 'Threshold',
    threshold: 'Threshold',
    protectDetail: 'Detail',
    reduceNoise: 'Noise',
    fingerPainting: 'Finger',
    pressureStrength: 'Pressure',
    range: 'Range',
    protectTones: 'Tones',
    airbrush: 'Airbrush',
    exposure: 'Exposure',
    vibrance: 'Vibrance',
    type: 'Type',
    stops: 'Stops',
    interpolation: 'Interp',
    smoothness: 'Smooth',
    noise: 'Noise',
    noiseSeed: 'Seed',
    reverse: 'Reverse',
    transparency: 'Transparency',
    dither: 'Dither',
    tolerance: 'Tolerance',
    contiguous: 'Contiguous',
    diagonal: 'Diagonal',
    perceptual: 'Perceptual',
    sampling: 'Sampling',
    limits: 'Limits',
    protectForeground: 'Protect',
    decontaminate: 'Decontaminate',
    sampleRadius: 'Sample',
    edgeAware: 'Edge',
    adaptive: 'Adaptive',
    sampling: 'Sampling',
    clickSearch: 'Click Search',
    autoEnhance: 'Auto Enhance',
    refineProvider: 'Refine',
    structure: 'Structure',
    color: 'Color',
    expand: 'Expand',
    sampleAllLayers: 'Sample All',
    sourceTransforms: 'Sources',
    sourceTransforms: 'Sources',
    // Text
    family: 'Font',
    color: 'Color',
    bold: 'Style',
    italic: 'Style',
    underline: 'Style',
    strikethrough: 'Style',
    align: 'Align',
    lineHeight: 'Line',
    tracking: 'Tracking',
    wordSpacing: 'Words',
    baselineShift: 'Baseline',
    boxWidth: 'Box',
    boxHeight: 'Box',
    warpStyle: 'Warp',
    warpBend: 'Warp',
    warpHorizontal: 'Warp',
    warpVertical: 'Warp',
    kerning: 'Kerning',
    ligatures: 'Ligatures',
    smallCaps: 'Small Caps',
    fontStretch: 'Width',
    fontWeight: 'Weight',
  }
  return groupMap[key] || 'Options'
}