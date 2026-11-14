# GIMP Compatibility Features

Chay's Photo Studio includes extensive GIMP 3.0 compatibility features across multiple modules.

## Table of Contents
1. [Workspace & Toolbox](#workspace--toolbox)
2. [Procedural Tools](#procedural-tools)
3. [Asset Import/Export](#asset-importexport)
4. [Filter Pipeline & Macros](#filter-pipeline--macros)
5. [Animation](#animation)
6. [Script-Fu & Procedural Database](#script-fu--procedural-database)
7. [Color Management](#color-management)
8. [Metadata Handling](#metadata-handling)
9. [XCF Import](#xcf-import)
10. [Patterns, Gradients & Palettes](#patterns-gradients--palettes)
11. [GEGL Operations](#gegl-operations)
12. [Text Tools](#text-tools)
13. [Analysis Tools](#analysis-tools)
14. [Guides, Grid & Snapping](#guides-grid--snapping)
15. [Paths & Vectors](#paths--vectors)
15. [Plugin Manager Integration](#plugin-manager-integration)

---

## Workspace & Toolbox

### Multi-Column Toolbox (GIMP-Style Grid Mode)
- **Location**: `src/editor/components/toolbar/toolbar.tsx`, `src/editor/store.ts`
- **Feature**: Toolbar supports both "rail" (vertical single-column) and "grid" (multi-column) modes
- **GIMP Preset**: Uses 2-column grid layout matching GIMP 3.0 toolbox
- **Configuration**: `ToolbarLayout` type with `mode: 'rail' | 'grid'`, `gridColumns`, `gridRowHeight`
- **Toolbar Customization Dialog**: Added grid mode toggle with column selector (2/3/4 columns)

### GIMP Workspace Preset
- **Location**: `src/editor/store.ts` → `defaultToolbarLayout('gimp')`
- **Layout**: 38 rows × 2 columns matching GIMP 3.0 toolbox arrangement
- **Includes**: All transform tools (rotate, scale, shear, perspective, unified, handle, flip, cage, warp), selection tools (scissors, foreground), paint tools (airbrush, ink, MyPaint brush)

---

## Procedural Tools

### New GIMP Tools Added
| Tool | ID | Shortcut | Category |
|------|-----|----------|----------|
| Alignment | `alignment` | Q | Transform |
| Rotate | `rotate` | Shift+R | Transform |
| Scale | `scale` | Shift+T | Transform |
| Shear | `shear` | Shift+S | Transform |
| Perspective | `perspective` | Shift+P | Transform |
| Unified Transform | `unified-transform` | Shift+T | Transform |
| Handle Transform | `handle-transform` | Shift+L | Transform |
| Flip | `flip` | Shift+F | Transform |
| Cage Transform | `cage-transform` | Shift+C | Transform |
| Warp Transform | `warp-transform` | Shift+W | Transform |
| Scissors Select | `scissors-select` | I | Selection |
| Foreground Select | `foreground-select` | G | Selection |
| Airbrush | `airbrush` | A | Paint |
| Ink | `ink` | K | Paint |
| MyPaint Brush | `mypaint-brush` | N | Paint |

### Tool Cycles Updated
- Transform tools cycle with Shift+letter shortcuts
- Selection tools include scissors/foreground select
- Paint tools include airbrush/ink/MyPaint brush

---

## Asset Import/Export

### GIMP Brush Formats (`src/editor/plugins/gimp-brush-import.ts`)
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| `.gbr` (grayscale/RGBA) | ✅ | ✅ | Standard GIMP brushes |
| `.vbr` (vector) | ✅ | ❌ | Parametric: circle/square/diamond |
| `.gih` (image hose) | ✅ | ❌ | Animated brushes with ranks |
| `.abr` (Photoshop) | ✅ | ❌ | ABR v1/v2/v6 support |

### GIMP Gradient Formats
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| `.ggr` (GIMP) | ✅ | ✅ | Text format with segments |
| `.grd` (Photoshop) | ❌ | ❌ | Not yet implemented |

### GIMP Palette Formats
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| `.gpl` (GIMP) | ✅ | ✅ | Text format with columns |
| `.aco` (Photoshop Swatches) | ✅ | ✅ | Binary format v1/v2 |
| `.ase` (Adobe Swatch Exchange) | ✅ | ❌ | XML-based format |
| JSON | ✅ | ✅ | Custom format |

### Procedural Generation
- Patterns: checker, grid, dots, stripes, noise, fibers, weave, hexagon
- Palette from image (color quantization)
- Export: `.gbr`, `.gpl`, `.ggr`, `.aco`

---

## Filter Pipeline & Macros

### Filter Pipeline System (`src/editor/plugins/gimp-filter-pipeline.ts`)
- **Pipeline Builder**: Visual builder with GEGL operation palette (30+ ops)
- **Storage**: localStorage with versioning
- **Execution**: Step-by-step with progress callbacks

### Built-in Pipelines (8)
| Pipeline | Description |
|----------|-------------|
| Vintage Photo | Sepia + vignette + grain + fade |
| High Contrast B&W | Desaturate + S-curve + crush blacks + sharpen |
| Dreamy Portrait | Soft blur + brighten + vibrance + bloom |
| Cinematic Teal & Orange | Color balance (shadows/midtones/highlights) + curves |
| Texture Overlay | Perlin noise + desaturate + levels |
| HDR Tone Mapping | Bilateral filter + unsharp mask + shadows/highlights |
| Ink Sketch | Desaturate + edge detect + invert + levels + blur |
| Watercolor | Bilateral + oilify + gimpressionist + tint + vignette |

---

## Animation

### Animation System (`src/editor/plugins/gimp-animation.ts`)
- **Frame Management**: Add/remove/duplicate/reorder frames from active layer
- **Onion Skinning**: Configurable prev/next frames (0-5), opacity (0-1), custom colors
- **Settings**: FPS (1-60), loop count (0=infinite), frame duration, background color
- **Export Formats**: GIF, WebP, APNG, Sprite Sheet (PNG)
- **Tweening**: 12 easing functions (linear, quad, cubic, quart, sine, expo, circ, back, elastic, bounce)
- **Sprite Sheets**: Auto-layout with configurable columns/padding

---

## Script-Fu & Procedural Database

### Script-Fu Support (`src/editor/plugins/gimp-script-fu.ts`)
- **Embedded TinyScheme**: Full Scheme interpreter via `embedded-scheme`
- **Built-in Scripts** (4):
  - Drop Shadow
  - Inner Glow
  - Bevel & Emboss
  - Chrome
- **PDB Procedures** (30+): Color ops, selection, layer, image, filters, color adjustments, transforms, context, file, display
- **Console**: Execute arbitrary Scheme code

### Procedural Database (`src/editor/plugins/gimp-procedural.ts`)
- **60+ Procedures**: Implemented in JavaScript for browser fallback
- **Categories**: Color, Selection, Layer, Image, Filters, Color Adjustments, Transforms, Context, File, Display
- **Unified Runner**: Tries native GIMP first, falls back to browser implementation

---

## Color Management

### Color Space Conversion (`src/editor/plugins/gimp-color-management.ts`)
- **Supported Spaces**: sRGB, AdobeRGB, ProPhotoRGB, Rec2020, Rec709, DCI-P3, Gray, CMYK, Lab
- **Conversion**: Bradford chromatic adaptation, D50/D65 white point handling
- **Rendering Intents**: Perceptual, Relative/Absolute Colorimetric, Saturation
- **Canvas-based**: Full canvas conversion with `convertCanvasColorSpace()`

### Soft Proofing
- **Framework**: Simulate output device colors
- **Gamut Warning**: Highlight out-of-gamut colors
- **Intent Selection**: Perceptual, Relative, Absolute, Saturation

### Built-in Profiles
- sRGB IEC61966-2.1
- Adobe RGB (1998)
- ProPhoto RGB
- ITU-R BT.2020
- DCI-P3
- Gray Gamma 2.2

---

## Metadata Handling

### Metadata Extraction (`src/editor/plugins/gimp-metadata.ts`)
| Format | Support | Details |
|--------|---------|---------|
| EXIF | ✅ | IFD0, ExifSubIFD, GPS |
| XMP | ✅ | Dublin Core, Photoshop, IPTC Core, Camera Raw |
| IPTC | ❌ | Planned |
| PNG Text | ✅ | tEXt, zTXt, iTXt |
| ICC Profile | ✅ | Embedded profile extraction |

### GIMP Parasites
- Layer position/offsets/mode/opacity/visibility/locked/linked
- Image guides/grid/resolution/unit
- Paths, selection, parasite list
- Custom parasite creation

### Export Options
- Selective inclusion (EXIF, IPTC, XMP, ICC, Parasites)
- GPS stripping
- Personal data stripping

---

## XCF Import

### XCF Parser (`src/editor/plugins/gimp-xcf.ts`)
- **Versions**: GIMP 2.8–3.0 (version ≤ 11)
- **Color Spaces**: RGB, Grayscale, Indexed
- **Precision**: 8-bit, 16-bit, 32-bit float
- **Features**:
  - Layer hierarchy with groups
  - Blend modes, opacity, visibility, lock states
  - Layer masks (vector + pixel)
  - RLE/ZIP tile decompression
  - Guides, grid, color space, precision
  - Parasite data (GIMP metadata)
- **Export**: Framework ready (not fully implemented)

---

## Patterns, Gradients & Palettes

### Pattern Formats (`src/editor/plugins/gimp-patterns.ts`)
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| GIMP `.pat` | ✅ | ✅ | Version 1, GPAT magic |
| Photoshop `.pat` | ✅ | ❌ | 8BIM signature, v1/v2/v6 |
| Procedural | ✅ | ✅ | 8 types + custom params |

### Gradient Formats
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| GIMP `.ggr` | ✅ | ✅ | Text format with segments |
| Photoshop `.grd` | ❌ | ❌ | Not implemented |
| CSS Export | N/A | ✅ | `linear-gradient()` strings |

### Palette Formats
| Format | Import | Export | Notes |
|--------|--------|--------|-------|
| GIMP `.gpl` | ✅ | ✅ | Name, columns, colors |
| Photoshop `.aco` | ✅ | ✅ | Swatches v1/v2 |
| Photoshop `.ase` | ✅ | ❌ | Swatch Exchange XML |
| JSON | ✅ | ✅ | Custom format |
| From Image | ✅ | N/A | Color quantization (k-means) |

---

## GEGL Operations

### GEGL Compatibility Layer (`src/editor/plugins/gegl-ops.ts`)
**70+ Operations** with canvas-based fallbacks:

| Category | Operations |
|----------|------------|
| Blur | gaussian-blur, box-blur, motion-blur, lens-blur |
| Enhance | unsharp-mask, high-pass, noise-reduction, bilateral-filter |
| Noise | noise (uniform/gaussian/poisson/laplacian), perlin-noise |
| Edge Detect | sobel, laplacian |
| Morphology | dilate, erode, opening, closing |
| Artistic | oilify, cartoon, cubism, gimpressionist |
| Distort | ripple, waves, whirl-pinch |
| Color Effects | colorize, desaturate, invert, posterize, threshold, channel-mixer |
| Transform | rotate, scale, flip, crop, perspective, lens-distortion |
| Composite | seamless-clone |

### Pipeline Builder
- **GeglGraph Class**: Chain multiple operations
- **GeglOperation Metadata**: Properties with types, defaults, ranges, enums
- **UI Integration**: Filter Pipelines tab with visual builder

---

## Text Tools

### Text on Path (`src/editor/plugins/gimp-text-tools.ts`)
- **Path Types**: SVGPathElement, Path2D, Point arrays
- **Options**: Alignment, baseline, offset, side (left/right/both), flip, start offset, length limit
- **Presets**: Circle top/bottom, Arc up/down, Wave, Spiral

### Text Warp (10 Types)
| Warp Type | Parameters |
|-----------|------------|
| Arc | Bend |
| Arch | Bend |
| Bulge | Bend |
| Shell | Bend |
| Flag | Bend |
| Wave | Horizontal/Vertical distortion |
| Fish | Bend |
| Rise | Bend |
| Squeeze | Horizontal/Vertical distortion |
| Twist | Bend |

**Presets** (13): Arc, Arc Lower, Arc Upper, Arch, Bulge, Shell Lower, Shell Upper, Flag, Wave, Fish, Rise, Squeeze, Twist

---

## Analysis Tools

### Analysis Suite (`src/editor/plugins/gimp-analysis-tools.ts`)
| Tool | Description |
|------|-------------|
| **Histogram** | RGB, R/G/B, Luminance channels with mean/median/stdDev/min/max |
| **Sample Points** | Persistent color samplers, relative/absolute positioning, live updates |
| **Colorcube** | 3D color histogram (32³ voxels), 2D projection rendering |
| **Border Average** | Top/bottom/left/right/all border colors |
| **Page Curl** | Realistic corner curl with shadow |
| **Threshold** | Otsu, ISOData (intermeans), Mean, Min/Max |
| **Exposure** | Over/under exposed pixel counting |
| **Sharpness** | Laplacian variance focus measure |

---

## Guides, Grid & Snapping

### GuideManager (`src/editor/plugins/gimp-guides-grid.ts`)
- **Guides**: Horizontal/vertical, colored, locked, labeled, visible
- **GridConfig**: Spacing, offsets, subdivisions, styles (lines/dots/crosses), opacity
- **Smart Snapping**: Guides, grid, canvas edges, layer edges/centers, element bounds
- **Threshold**: Configurable 1-50px, priority-based target selection

### Auto Guides
- **Edge Detection**: Sobel-based horizontal/vertical edge detection
- **Clustering**: Groups nearby edges, picks strongest per cluster

### Preset Guides
| Preset | Description |
|--------|-------------|
| Golden Ratio (φ) | φ, φ² vertical/horizontal lines |
| Rule of Thirds | ⅓ and ⅔ lines |
| Center | Horizontal + vertical center |

---

## Paths & Vectors

### PathManager (`src/editor/plugins/gimp-paths.ts`)
- **Path Points**: Corner, smooth, symmetric with handles in/out
- **Operations**: Add/remove/move points, set type, set handles, toggle closed
- **Path Operations**: Path-to-selection (feather), stroke, fill
- **SVG Import/Export**: Full SVG path parsing (M, L, H, V, C, S, Q, T, A, Z)
- **Path Presets**: Rectangle, Ellipse, Triangle, Star, Heart
- **Simplification**: Douglas-Peucker algorithm
- **From Selection**: Marching squares contour tracing + simplification

---

## Plugin Manager Integration

### New Tabs in Plugin Manager (`src/editor/components/dialogs/plugin-manager-dialog.tsx`)

| Tab | Feature |
|-----|---------|
| **GIMP Procedural** | Browse/run 60+ PDB procedures + 30+ GEGL ops |
| **GIMP Script-Fu** | Run built-in scripts, Scheme console |
| **Color Management** | Convert color spaces, soft proofing setup |
| **Metadata** | Extract EXIF/XMP/IPTC/PNG text/ICC |
| **XCF Import** | Parse GIMP XCF with layers/masks/guides |
| **Filter Pipelines** | Build/run/save filter pipelines |
| **Animation** | Frame-based animation with onion skinning |

### Features by Tab
| Tab | Key Features |
|-----|-------------|
| Procedural | Category filter, progress feedback, native GIMP fallback |
| Script-Fu | 4 built-in scripts, Scheme console, procedure registry |
| Color Mgmt | 9 color spaces, 4 rendering intents, soft proofing UI |
| Metadata | EXIF/XMP/PNG text/ICC display, export/strip buttons |
| XCF Import | Layer hierarchy preview, batch import, export framework |
| Filter Pipelines | Visual builder, 8 built-in, save/load custom |
| Animation | Onion skinning, 12 easings, GIF/WebP/APNG/Sprite Sheet export |

---

## Usage Examples

### Creating a Vintage Photo Pipeline
```typescript
import { getAllPipelines, executePipeline } from './plugins/gimp-filter-pipeline';

const pipeline = getAllPipelines().find(p => p.id === 'pipeline-vintage-photo');
const result = await executePipeline(pipeline, layer.canvas, (step, progress) => {
  console.log(`${step.label}: ${Math.round(progress * 100)}%`);
});
```

### Converting Color Spaces
```typescript
import { convertCanvasColorSpace, SRGB_PROFILE } from './plugins/gimp-color-management';

const adobeRGB = await convertCanvasColorSpace(canvas, 'sRGB', 'AdobeRGB', 'relative');
```

### Adding Guides
```typescript
import { GuideManager, createGoldenRatioGuides } from './plugins/gimp-guides-grid';

const guides = new GuideManager();
guides.setCanvasSize(1920, 1080);
createGoldenRatioGuides(guides);
createRuleOfThirdsGuides(guides);
```

### Running Script-Fu
```typescript
import { runScriptFu, listBuiltInScripts } from './plugins/gimp-script-fu';

const scripts = listBuiltInScripts(); // ['script-fu-drop-shadow', ...]
const result = await runScriptFu(scriptSource, { image: dataUrl });
```

---

## Future Enhancements (Planned)

1. **Full XCF Export** - Complete XCF writer with all layer features
2. **Photoshop .grd/.abr** - Full import/export support
3. **Non-destructive Filters** - Smart filters with GEGL graph persistence
4. **Advanced Animation** - Keyframe interpolation, motion paths
5. **Python-Fu Bridge** - Full Python 3 support via Pyodide
6. **GIMP Plug-in Host** - Native binary plugin support (Electron only)
7. **Advanced Path Tools** - Path boolean operations, offset, simplify
8. **Color Management v2** - Little CMS integration, 3D LUT support