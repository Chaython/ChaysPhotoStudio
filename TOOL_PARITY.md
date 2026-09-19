# Tool parity audit

This document tracks the editor tool surface against common Adobe Photoshop workflows.
"Parity" here means the interaction and editing model is reasonably familiar, not binary-compatible reproduction of Adobe internals.

| Tool | Current Photoshop-style behavior | Remaining deeper work |
|---|---|---|
| Move | Auto-select, transform controls, canvas hit testing, Alt-drag duplicate, Shift axis constraint, guide/grid snapping, off-canvas pixels preserved, live scale/rotate handles | Multi-layer selection/alignment/distribution and smart guides between layer bounds |
| Rectangular Marquee | New/Add/Subtract/Intersect, feather, anti-alias, fixed ratio/size, Shift square, Alt from center, guide snapping | Drag existing selection boundary without moving pixels; saved preset UI |
| Elliptical Marquee | Same selection modes/constraints as rectangular marquee | Selection-boundary transform controls |
| Lasso | Freehand selection, feather/AA, jitter smoothing, modifier combine modes | Magnetic handoff while drawing and path edge refinement inline |
| Polygonal Lasso | Click vertices, close affordance, Enter/double-click commit, Backspace vertex delete, configurable Shift angle snapping | Mid-path segment editing before commit |
| Magnetic Lasso | Edge-gradient snapping, width/contrast/frequency, active-layer/composite sampling, Alt freehand fallback | More advanced edge-cost path solver and anchor deletion/repositioning |
| Object Selection | Rectangle and lasso targeting, active-layer/all-layer sampling, Fast/Balanced/Thorough refinement, feather/AA | True ML segmentation provider selection and click-to-object mode |
| Quick Selection | Brush region growing, active/all-layer sampling, add/subtract/intersect, tolerance, auto-enhance, feather | Learned boundary model and live Refine Edge handoff |
| Magic Wand | Perceptual Lab matching, edge protection, adaptive region mean, point/3x3/5x5/7x7 samples, contiguous/global, diagonal, alpha matching, exact-pixel mode, smooth/feather/AA | Cached worker/WebGPU large-image acceleration |
| Crop | Editable 8-handle crop box, move/resize, standard/custom ratios, overlays, Shift square, Alt from center, guide snapping, non-destructive hidden-pixel preservation | Straighten tool, perspective crop, target resolution/resampling |
| Eyedropper | Point/averaged samples, active/all-layer source, Alt background color, continuous drag sampling, hover preview | Color-ring/HUD readout in multiple color spaces |
| Measure | Length/angle/delta readout, configurable Shift angle snap, overlay/status publication, optional persistence across tools | Multi-segment measurements and scale calibration |
| Brush | Size/hardness/opacity/flow/spacing, blend modes, procedural/imported tips, angle/roundness/follow, smoothing, pressure, velocity dynamics, scatter, fade, airbrush, symmetry/mandala | Full brush preset editor, texture/dual-brush, tilt/rotation dynamics |
| Pencil | Hard-edged painting, opacity/spacing, blend modes, auto-erase, pressure flow, symmetry | Pixel-grid-aware line correction and advanced pencil presets |
| Eraser | Brush/Pencil/Block modes, procedural tips, hardness/flow/opacity/spacing, pressure flow/size, angle/roundness/follow, symmetry | Erase-to-history and background eraser family |
| Clone Stamp | Alt source, aligned/non-aligned, active/composite sample, hardness/flow/opacity/spacing, blend modes, rotate/scale/mirror source, source overlay | Clone Source panel with multiple stored sources |
| Healing Brush | Alt source, aligned sampling, active/all layers, diffusion, pressure, rotate/scale/mirror, blend modes, frequency-style healing | Pattern source mode and richer healing modes |
| Spot Healing | Content-Aware/Proximity, hardness/size, Sample All Layers, selection-aware healing, non-destructive New Layer output | Structure/color adaptation controls and ML provider option |
| Patch | Freehand patch lasso, drag-to-source preview, texture/content-aware healing, diffusion, Sample All Layers | Destination mode, pattern mode, adaptation controls |
| Blur | Soft brush, hardness/strength, pressure, efficient separable blur, selection-aware | Sample-All-Layers output-to-new-layer workflow |
| Sharpen | Brush strength/hardness, pressure, threshold, unsharp behavior, selection-aware | Protect detail/noise and sample-all-layers workflow |
| Smudge | Strength/hardness, fine smear stepping, Sample All Layers, Finger Painting, selection-aware | Pressure strength/size and brush-tip library integration |
| Dodge | Shadows/Midtones/Highlights, exposure, pressure, Protect Tones, Alt temporary Burn | Airbrush accumulation and richer tonal protection |
| Burn | Shadows/Midtones/Highlights, exposure, pressure, Protect Tones, Alt temporary Dodge | Airbrush accumulation and richer tonal protection |
| Sponge | Saturate/Desaturate, flow, vibrance mode, pressure, Alt temporary reverse | More perceptual saturation model and airbrush accumulation |
| Gradient | Linear/Radial/Angle/Reflected/Diamond, foreground/background/transparency/spectrum, reverse, opacity, blend modes, transparency, dither, live preview, Shift angle constraint | Full editable gradient-stop UI in tool options and perceptual interpolation |
| Paint Bucket | Active/all-layer sampling, foreground/background, blend/opacity, perceptual color matching, contiguous/global, diagonal, AA and edge smoothing | Pattern fill and content-aware fill handoff |
| Type | Editable text layers, existing-text hit activation, font/size/color, bold/italic, underline/strikethrough, alignment, leading, tracking | Paragraph text boxes, kerning pairs, variable fonts, warp text, vertical type |
| Pen | Corner/smooth anchors, draggable Bezier handles, Alt break handles, Shift 45-degree handles, anchor/handle editing, close affordance, corner/smooth conversion, selection/stroke/fill output | Persistent named paths panel, boolean path operations, vector masks |
| Shape | Rectangle/Rounded Rect/Ellipse/Triangle/Polygon/Star/Line, fill/stroke colors, fill/stroke opacity, stroke width, line caps, radius/points/inset, Shift constraint, Alt from center | Stroke alignment, dashed strokes, arrowheads, path boolean operations |
| Hand | Space-drag temporary pan, dedicated Hand tool, double-click Fit on Screen | Flick/inertial pan preference |
| Zoom | Click zoom, Alt zoom-out, scrubby zoom, cursor-centered zoom, double-click 100% | Drag-rectangle zoom and resize-window-to-fit preference |

## Shared behavior standards

All pixel-editing tools should remain selection-aware and undoable. Raster content outside the document frame must remain preserved unless the user explicitly chooses destructive cropping. Tools that can reasonably sample a flattened view should distinguish **sampling source** from **output destination** so "Sample All Layers" never accidentally flattens visible layers into the target.

New tool work should prefer shared engines rather than duplicate implementations: selection tools should use the grayscale mask pipeline; brush-like tools should use common stroke/dynamics infrastructure; perceptual color-region tools should reuse the Wand matcher; and destructive operations should offer a new-layer or smart/non-destructive route where practical.
