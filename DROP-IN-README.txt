Illustrator / GIMP / Fireworks workspaces — drop-in files
Built on main @ c1df1c0 (after the hotspot shapes commit).
Verified: tsc --noEmit = 0 errors, eslint clean, production build OK,
workspace-presets:validate + all existing validations pass.

HOW TO INSTALL
1. Copy every file over the repo root, keeping folder structure.
   Overwrite the 12 existing files; scripts/validate-workspace-presets.ts is NEW.
2. Run:  bun install
3. Verify: bun run workspace-presets:validate
           bunx tsc --noEmit
4. Commit & push. The CI step "Validate workspace preset templates"
   (added to .github/workflows/ci.yml) runs automatically.

WHAT YOU GET
- Workspace selector now offers: Classic / custom, Photoshop-style,
  Illustrator-style, GIMP-style, Fireworks-style (top-right selector
  and the app menu).
- Each template reorders all 56 registered tools into familiar flyout
  groupings — nothing is hidden; every tool stays reachable.
- Per-template inspector stacks:
  * Photoshop: Color/Adjustments/Properties/Navigator/Histogram +
    Layers/Channels/Paths/History/Actions (unchanged, Essentials)
  * Illustrator: Color/Properties/Navigator/Presets +
    Layers/Paths/Layer Comps/Actions/History
  * GIMP: Color/Presets/Patterns/Clone + Layers/Channels/Paths/History
  * Fireworks: Color/Info/Histogram/Navigator +
    Layers/Layer Comps/History/Metadata, and the Properties panel
    docked as a BOTTOM strip under the canvas (like Fireworks)
- Each workspace remembers its own edited tool/panel layouts, has its
  own locks and its own reset template; the inspector reset button
  restores the active template's tab groups.
- New headless CI validation script + docs (README, USER_GUIDE, help
  topics) and CHANGELOG entry.
