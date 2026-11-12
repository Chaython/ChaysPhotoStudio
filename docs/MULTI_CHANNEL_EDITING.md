# Channel Editing Targets — multi-channel editing

**Status:** Phases 1–3 shipping (painting/fill/bucket/gradient + targets UI, adjustments/filters/dialogs, clipboard planes, combined Curves/Levels entries).
**Parity target:** Photoshop semantics, using PhotoCraft's published behaviour as the parity reference (implementation is Studio's own; see `docs/ATTRIBUTIONS.md`).

## What it does

Shift-click colour rows in the Channels panel to add or remove them from the **editing target**. Only native colour channels (R/G/B) can be combined — masks, saved alpha channels and Quick Mask never join a colour set.

- **All three selected = Composite.** Plain click targets one channel and shows it alone (no change to the existing solo-view UX).
- **Partial set = write restriction.** Painting tools (brush/pencil/erasers/clone/pattern/heal/mixer/history brushes), bucket, gradient, Fill, Stroke Selection, destructive adjustments and supported filters write **only** the targeted colour components. Every other component — including the layer alpha — is preserved **byte-for-byte**.
- **Cross-component ops read full inputs.** A red-targeted Curves/Levels adjusts from the original R value but writes R only; a blur's neighbour reads come from the full composite, writes are restricted.
- **Eraser semantics:** erasing under a colour target paints the toolbox background colour into the targeted components, preserving transparency.
- **Selections still constrain** (feathered selections compose with the channel target).
- **One undo step per commit.** Dialogs capture the target when opened; recorded Actions replay with the captured target; an explicit `target` in op args wins over panel state.
- **Refusals (transactional, before any modification):** Move/transforms, `camera-raw`, `hdr-toning`, new-layer render options, transparency-generating renders on colour-only targets.
- **RGB only** today; CMYK/Lab docs are approximated previews and stay at Composite until a channel model exists for them. 8/16/32-bit all supported.

## How it works

The target lives on the document as `doc.channelTarget: 'composite' | 'r' | 'g' | 'b' | 'rg' | 'rb' | 'gb'`, mirrored in the editor store, captured in every History snapshot, and round-tripped in project files.

The restriction is enforced **at the commit points**, not inside each op math:

1. Snapshot the protected (unselected) planes of the affected region before the operation.
2. Run the operation normally against full-colour inputs (selection still applies as today).
3. Restore the protected planes byte-exact from the snapshot; targeted components keep their new values.

Commit sites: `endStroke` (brush/eraser/clone/etc. — bbox-scoped snapshot), `regionProcess`/float dab writers (retouch — region-scoped), `fillSelection` both branches, bucket/gradient tmp-canvas commits, `commitComputedPixelOp` (adjustments/filters sync + async worker). `mergeHdrCanvasEdits` diff-merge means 32-bit `hdrPixels` stay byte-exact too, including HDR values beyond 1.0, signed zeros and NaN payloads.

**Zero overhead when target is `composite`** — the snapshot/restore machinery is skipped entirely.

## Display

A targeted subset renders targeted components in colour and protected components as desaturated grayscale (GPU `uMask` shader + CPU plane pass). `getFlatComposite` is unchanged (sampling/histogram/export see the true composite); `flatKey` is extended with `channelTarget`.

## Milestones

- Phase 1 (done): state + panel UX + subset rendering + restriction at painting/fill/bucket/gradient + refusal guards + validator.
- Phase 2 (done): adjustments/filters via `commitComputedPixelOp`, dialogs capture target, Actions `playStep` replay.
- Phase 3 (done): clipboard component planes, combined Curves/Levels channel entries, docs/parity/CHANGELOG updates.

**Remaining:** paint-into-saved-channel (Photoshop lets you paint a saved channel as a grayscale layer), `.atn` round-trip for targeted steps (may land as a TEXT placeholder), CMYK/Lab channel targets.

## Validator

`scripts/validate-channel-editing.ts` — headless regression groups mirroring the behaviour matrix: set membership/transactionality, per-depth byte-exactness of unselected planes (8/16/32), eraser transparency preservation, fill/bucket subsets, adjustment/filter equivalence vs composite-run plus undo/redo, transactional refusals, Actions replay with/without target, feathered-selection interplay, Curves/Levels combined channel entries.

Run with:

```
node --import "file:///C:/Users/Chay/AppData/Local/Temp/opencode/ts-register.mjs" scripts/validate-channel-editing.ts
```
