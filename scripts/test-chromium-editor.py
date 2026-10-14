#!/usr/bin/env python3
"""Actual Chromium end-to-end checks against the exported Chay's Photo Studio UI.

Unlike DOM unit tests, these open the production build in the browser and
exercise React components, persisted state, pointer interactions and image IO.
No external web services, third-party models, or native plugins are used.
"""
from __future__ import annotations

import os
import re
import shutil
import struct
import sys
import traceback
import hashlib
import urllib.request
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from video_fixture import video_fixture

APP_URL = os.getenv("CHAYS_E2E_URL", "http://127.0.0.1:8765/")
ARTIFACTS = Path(os.getenv("CHAYS_E2E_ARTIFACTS", "build/chromium-e2e"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
RESULTS: list[tuple[str, bool, str]] = []
ACTIVE_PAGE = None

DOCKS = {
    "top-left": ("documents", "Open Files"),
    "top": ("tool-options", "Tool Options"),
    "top-right": ("layers", "Layers"),
    "bottom-left": ("navigator", "Nav"),
    "bottom": ("history", "History"),
    "bottom-right": ("channels", "Channels"),
    "left": ("metadata", "Metadata"),
    "right": ("color", "Color"),
}


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def approx(actual: float, expected: float, tolerance: float = 4) -> None:
    check(abs(actual - expected) <= tolerance,
          f"expected {expected:.0f}px ±{tolerance:.0f}, got {actual:.1f}px")


def pixel_png(width=8, height=8) -> bytes:
    # Valid RGB PNG generated without Pillow or network fixtures.
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
    raw = b"".join(b"\x00" + bytes([30, 100, 210] * width) for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def pdf_fixture() -> bytes:
    """Minimal, valid two-page vector PDF with distinct solid page colors."""
    one = b"1 0 0 rg 0 0 200 120 re f\n0 0 0 rg BT /F1 16 Tf 15 60 Td (First page) Tj ET\n"
    two = b"0 0 1 rg 0 0 200 120 re f\n1 1 1 rg BT /F1 16 Tf 15 60 Td (Second page) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(one)).encode() + b" >>\nstream\n" + one + b"endstream",
        b"<< /Length " + str(len(two)).encode() + b" >>\nstream\n" + two + b"endstream",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for at in offsets[1:]:
        out.extend(f"{at:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(out)


def app_page(browser, size=(1440, 900), track_workers=False):
    global ACTIVE_PAGE
    context = browser.new_context(viewport={"width": size[0], "height": size[1]},
                                  service_workers="block", accept_downloads=True)
    if track_workers:
        context.add_init_script("""(() => {
            const BaseWorker = window.Worker
            const record = { created: 0, terminated: 0 }
            window.__workerTestRecord = record
            window.Worker = class TrackedWorker extends BaseWorker {
                constructor(...args) { super(...args); record.created++ }
                terminate() { record.terminated++; return super.terminate() }
            }
        })()""")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    resp = page.goto(APP_URL, wait_until="domcontentloaded", timeout=60000)
    check(resp is not None and resp.status == 200, "exported application did not return HTTP 200")
    # Mobile deliberately renders drawers instead of desktop dock elements.
    page.wait_for_function(
        "() => !!window.__zphotoStore && !!window.__zphotoEngine",
        timeout=60000,
    )
    if size[0] >= 768:
        page.locator('[data-panel-dock="right"]').wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(800)
    ACTIVE_PAGE = page
    check(not errors, f"uncaught JavaScript startup errors: {errors[:3]}")
    return context, page, errors


def store(page, expression: str):
    return page.evaluate(
        "(expression) => { const st = window.__zphotoStore.getState(); return Function('s', 'return (' + expression + ')')(st) }",
        expression,
    )


def route_eight_docks(page):
    assignments = [{"side": side, "id": id} for side, (id, _) in DOCKS.items()]
    page.evaluate("""(assignments) => {
      for (const {id, side} of assignments) window.__zphotoStore.getState().dockPanel(id, side)
    }""", assignments)
    for side, (_, label) in DOCKS.items():
        dock = page.locator(f'[data-panel-dock="{side}"]').first
        dock.wait_for(state="visible", timeout=15000)
        check(dock.bounding_box() is not None, f"{side} dock has no rendered geometry")
        check(label.lower() in dock.inner_text(timeout=8000).lower(),
              f"{side} dock is missing the {label} panel")
    check(store(page, "Object.keys(s.panels.floating).length") == 0,
          "moving panels among docks unexpectedly created floating windows")


def run_test(name, fn):
    global ACTIVE_PAGE
    ACTIVE_PAGE = None
    try:
        fn()
        RESULTS.append((name, True, ""))
        print(f"PASS {name}", flush=True)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        RESULTS.append((name, False, msg))
        print(f"FAIL {name}: {msg}", flush=True)
        traceback.print_exc(limit=2)
        if ACTIVE_PAGE:
            try:
                ACTIVE_PAGE.screenshot(path=str(ARTIFACTS / (name + ".png")), full_page=True, timeout=10000)
            except Exception:
                pass
    finally:
        if ACTIVE_PAGE:
            try:
                ACTIVE_PAGE.context.close()
            except Exception:
                pass
        ACTIVE_PAGE = None


def main():
    with sync_playwright() as playwright:
        executable = (shutil.which("google-chrome") or shutil.which("google-chrome-stable")
                      or shutil.which("chromium"))
        if not executable:
            raise RuntimeError("Chromium/Google Chrome is not installed on the CI runner")
        print(f"Launching real Chromium: {executable}", flush=True)
        browser = playwright.chromium.launch(executable_path=executable, headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader",
                  "--use-gl=angle", "--use-angle=swiftshader"])
        try:
            def startup():
                _, page, errors = app_page(browser)
                check(page.locator('body').inner_text(timeout=15000).strip() != "", "editor is blank")
                check(page.locator('button[aria-label="Workspace template"]').is_visible(), "workspace switch is missing")
                check(page.locator('[data-panel-dock="right"]').is_visible(), "right dock failed to render")
                check(not errors, "startup threw JavaScript errors")

            def all_routes():
                _, page, errors = app_page(browser)
                route_eight_docks(page)
                metrics = page.evaluate("""() => Array.from(document.querySelectorAll('[data-panel-dock]'))
                  .filter(e => getComputedStyle(e).display !== 'none')
                  .map(e => ({ side: e.dataset.panelDock, width: Math.round(e.getBoundingClientRect().width),
                    height: Math.round(e.getBoundingClientRect().height) }))""")
                print("  Dock metrics:", metrics, flush=True)
                check(not errors, f"docking threw uncaught errors {errors[:3]}")

            def resize_reset():
                _, page, _ = app_page(browser)
                route_eight_docks(page)
                page.evaluate("""() => {
                  const s = window.__zphotoStore.getState()
                  s.setHorizontalDockHeight('top-left', 94)
                  s.setHorizontalDockHeight('top-right', 164)
                  s.setHorizontalDockHeight('bottom', 80)
                  s.setLeftDockWidth(343)
                  s.setDockWidth(379)
                }""")
                page.wait_for_timeout(300)
                approx(page.locator('[data-panel-dock="top-left"]').bounding_box()["height"], 94)
                approx(page.locator('[data-panel-dock="top-right"]').bounding_box()["height"], 164)
                approx(page.locator('[data-panel-dock="left"]').bounding_box()["width"], 343)
                approx(page.locator('[data-panel-dock="right"]').bounding_box()["width"], 379)
                page.locator('[data-panel-dock="top-left"] [role="separator"]').dblclick()
                page.wait_for_function("() => window.__zphotoStore.getState().panels.dockHeights['top-left'] === undefined")
                check(store(page, "s.panels.dockHeights['top-right']") == 164,
                      "resetting top-left also changed top-right")
                page.locator('[data-panel-dock="left"] [role="separator"]').dblclick()
                check(store(page, "s.panels.leftWidthManual") is False,
                      "double-click failed to restore automatic left width")
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("() => !!window.__zphotoStore && document.querySelector('[data-panel-dock=\"top-right\"]')?.offsetHeight > 0", timeout=30000)
                check(store(page, "s.panels.dockHeights['top-right']") == 164,
                      "reload discarded manually resized top-right dock")
                check(store(page, "s.panels.dockHeights['top-left']") is None,
                      "reload incorrectly restored reset top-left override")
                check(store(page, "s.panels.dockWidthManual") is True, "reload lost right width override")

            def context_float():
                _, page, _ = app_page(browser)
                route_eight_docks(page)
                title = page.locator('[data-panel-dock="top-left"] [title*="Open Files"]').first
                title.click(button="right")
                page.get_by_role("menuitem", name=re.compile(r"Dock bottom right", re.I)).click()
                page.wait_for_function("() => window.__zphotoStore.getState().panels.dockSide.documents === 'bottom-right'")
                check("Open Files" in page.locator('[data-panel-dock="bottom-right"]').inner_text(),
                      "context menu changed store without moving the panel")
                # Wait for Radix to complete the previous menu-close transition
                # before opening the newly mounted panel's context menu.
                page.wait_for_timeout(550)
                dest = page.locator('[data-panel-dock="bottom-right"] [title*="Open Files"]').first
                page.evaluate("""() => {
                    window.__contextEvents = []
                    window.__dockChanges = []
                    const pos = () => ({
                        dock: window.__zphotoStore.getState().panels.dockSide.documents,
                        floating: !!window.__zphotoStore.getState().panels.floating.documents
                    })
                    window.__zphotoStore.subscribe((current, previous) => {
                        if (current.panels.dockSide.documents !== previous.panels.dockSide.documents
                            || !!current.panels.floating.documents !== !!previous.panels.floating.documents) {
                            window.__dockChanges.push({
                                before: { dock: previous.panels.dockSide.documents, floating: !!previous.panels.floating.documents },
                                after: pos(), stack: new Error('dock change').stack?.slice(0, 1500)
                            })
                        }
                    })
                    for (const type of ['pointerdown','pointermove','pointerup','contextmenu']) {
                        document.addEventListener(type, e => {
                            const target = e.target?.closest?.('[data-panel-dock]')?.dataset.panelDock
                            if (window.__contextEvents.length < 60)
                                window.__contextEvents.push({
                                    type, button:e.button, buttons:e.buttons, targetDock:target,
                                    x:e.clientX, y:e.clientY, prevented:e.defaultPrevented
                                })
                        }, true)
                    }
                }""")
                print("  Before second right-click:", page.evaluate("""() => ({
                    side: window.__zphotoStore.getState().panels.dockSide.documents,
                    titleDock: Array.from(document.querySelectorAll('[title*="Open Files"]')).map(e=>e.closest('[data-panel-dock]')?.dataset.panelDock)
                })"""), flush=True)
                dest.click(button="right")
                try:
                    page.get_by_role("menuitem", name=re.compile(r"Float panel", re.I)).wait_for(state="visible", timeout=4000)
                except Exception:
                    print("  Context diagnostics:", page.evaluate("""() => ({
                      events: window.__contextEvents,
                      changes: window.__dockChanges,
                      dockSide: window.__zphotoStore.getState().panels.dockSide.documents,
                      floating: !!window.__zphotoStore.getState().panels.floating.documents,
                      titles: Array.from(document.querySelectorAll('[title*="Open Files"]'))
                        .map(el => ({title: el.getAttribute('title'),
                          dock: el.closest('[data-panel-dock]')?.getAttribute('data-panel-dock'),
                          outer: el.outerHTML.slice(0, 320),
                          x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y})),
                      menuCount: document.querySelectorAll('[role="menu"]').length,
                      availableMenuItems: Array.from(document.querySelectorAll('[role="menuitem"]'))
                        .map(el => el.textContent?.trim()).slice(-15),
                    })"""), flush=True)
                    raise
                page.get_by_role("menuitem", name=re.compile(r"Float panel", re.I)).click()
                page.wait_for_function("() => !!window.__zphotoStore.getState().panels.floating.documents")
                check("Open Files" not in page.locator('[data-panel-dock="bottom-right"]').inner_text(),
                      "floating a panel left a duplicate dock copy")

            def workspace_and_dialog():
                _, page, _ = app_page(browser)
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("menuitem", name="Photoshop-style").click()
                page.wait_for_function("() => window.__zphotoStore.getState().workspacePreset === 'photoshop'")
                check(page.locator('[data-photoshop-dock="true"]').is_visible(),
                      "Photoshop inspector workspace missing")
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("menuitem", name="Classic / custom").click()
                page.wait_for_function("() => window.__zphotoStore.getState().workspacePreset === 'classic'")
                page.evaluate("() => window.__zphotoStore.getState().openDialog('all-tools')")
                page.get_by_role("dialog").wait_for(state="visible", timeout=15000)
                # This is a lazy-loaded dialog; the initial shell says "Loading dialog...".
                page.get_by_role("textbox", name="Search all tools").wait_for(state="visible", timeout=30000)
                check(page.get_by_role("list", name="Available tools").get_by_role("listitem").count() >= 10,
                      "All Tools dialog did not render its registered tools")

            def workspace_layout_profiles():
                _, page, errors = app_page(browser)
                result = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('classic')
                    s.setToolbarLayout([{kind:'single', tool:'brush'}])
                    s.setDockWidth(340)
                    s.saveNamedLayout('Test tools', 'tools')
                    s.saveNamedLayout('Test panels', 'panels')
                    const exported = s.exportNamedLayout('Test tools')
                    s.setWorkspacePreset('photoshop')
                    const first = window.__zphotoStore.getState()
                    const isolated = first.toolbarLayout === null && first.panels.dockWidth !== 340
                    first.setToolbarLayout([{kind:'single', tool:'eraser'}])
                    first.setWorkspacePreset('classic')
                    const restored = window.__zphotoStore.getState()
                    const classic = restored.toolbarLayout?.[0]?.tool === 'brush' && restored.panels.dockWidth === 340
                    restored.setWorkspacePreset('photoshop')
                    const photoshop = window.__zphotoStore.getState().toolbarLayout?.[0]?.tool === 'eraser'
                    const importedName = window.__zphotoStore.getState().importNamedLayout(
                        exported.replace('"Test tools"', '"Imported tools"'))
                    window.__zphotoStore.getState().applyNamedLayout(importedName)
                    const applied = window.__zphotoStore.getState().toolbarLayout?.[0]?.tool === 'brush'
                    const untouched = window.__zphotoStore.getState().panels.dockWidth !== 340
                    return {isolated, classic, photoshop, applied, untouched}
                }""")
                check(all(result.values()), f"Workspace layout isolation failed: {result}")
                # Simple tab/color preference changes must be part of the workspace
                # profile and survive reload, not just drag/dock operations.
                safeguards = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setRightPanelTab('history')
                    s.toggleColorPanel()
                    s.setPhotoshopInspector({upperTab:'adjustments', lowerTab:'history', upperPercent:55, collapsed:true})
                    s.saveNamedLayout('Inspector snapshot', 'panels')
                    const exportedPanels = JSON.parse(s.exportNamedLayout('Inspector snapshot'))
                    const inspectorExport = exportedPanels.panels.photoshopInspector.upperPercent === 55 &&
                        exportedPanels.panels.photoshopInspector.collapsed === true
                    const before = window.__zphotoStore.getState().savedLayouts.length
                    const imported = s.importNamedLayout(s.exportNamedLayout('Test tools'))
                    const duplicated = imported === 'Test tools (2)' &&
                        window.__zphotoStore.getState().savedLayouts.length === before + 1
                    let rejected = false
                    try { s.importNamedLayout(JSON.stringify({
                        version:1, name:'Invalid dimensions', kind:'panels',
                        panels:{ dockSide:{}, floating:{}, dockWidth:'bogus' }
                    })) } catch { rejected = true }
                    return {duplicated, rejected, inspectorExport}
                }""")
                check(all(safeguards.values()), f"Import safety failed: {safeguards}")
                # Test the actual file-picker UI path, not just the store import
                # method. Importing a saved layout must not auto-apply it.
                ui_import = page.evaluate("""() => window.__zphotoStore.getState()
                    .exportNamedLayout('Test tools').replace('"Test tools"', '"Browser JSON layout"')""")
                toolbar_before_file = store(page, "JSON.stringify(s.toolbarLayout)")
                page.locator('input[data-file-purpose="layout"]').set_input_files({
                    "name": "browser-layout.zlayout.json",
                    "mimeType": "application/json",
                    "buffer": ui_import.encode("utf-8"),
                })
                page.wait_for_function("""() => window.__zphotoStore.getState()
                    .savedLayouts.some(x => x.name === 'Browser JSON layout')""", timeout=15000)
                check(store(page, "JSON.stringify(s.toolbarLayout)") == toolbar_before_file,
                      "Importing a named layout unexpectedly changed the active toolbar")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.workspacePreset") == "photoshop",
                      "reload forgot workspace selection")
                check(store(page, "s.toolbarLayout?.[0]?.tool") == "brush",
                      "reload forgot imported tool layout")
                check(store(page, "s.panels.rightTab") == "history",
                      "reload forgot the active Photoshop panel tab")
                check(store(page, "s.panels.colorPanelOpen") is False,
                      "reload forgot the color panel visibility")
                check(store(page, "s.panels.photoshopInspector.upperPercent") == 55,
                      "reload forgot the Photoshop inspector split")
                check(store(page, "s.panels.photoshopInspector.upperTab") == "adjustments",
                      "reload forgot the top inspector tab")
                check(store(page, "s.panels.photoshopInspector.lowerTab") == "history",
                      "reload forgot the bottom inspector tab")
                check(store(page, "s.panels.photoshopInspector.collapsed") is True,
                      "reload forgot inspector collapsed state")
                check(store(page, "s.savedLayouts.some(x => x.name === 'Test tools (2)')") is True,
                      "reload lost a collision-safe imported layout")
                page.evaluate("() => window.__zphotoStore.getState().setWorkspacePreset('classic')")
                check(store(page, "s.panels.dockWidth") == 340,
                      "switching after reload lost Classic's panel width")
                check(store(page, "s.toolbarLayout?.[0]?.tool") == "brush",
                      "switching after reload lost Classic's toolbar")
                # Reset applies the active workspace's initial template only;
                # named presets and the other workspace must remain intact.
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("menuitem", name="Restore Classic template").click()
                check(store(page, "s.toolbarLayout") is None,
                      "factory reset did not restore Classic toolbar")
                check(store(page, "s.panels.dockWidth") == 264,
                      "factory reset did not restore Classic dock width")
                check(store(page, "s.savedLayouts.some(x => x.name === 'Inspector snapshot')") is True,
                      "factory reset unexpectedly deleted a named layout")
                page.evaluate("() => window.__zphotoStore.getState().setWorkspacePreset('photoshop')")
                check(store(page, "s.panels.photoshopInspector.upperPercent") == 55,
                      "Classic reset incorrectly changed Photoshop inspector")
                check(store(page, "s.panels.photoshopInspector.collapsed") is True,
                      "Classic reset incorrectly expanded Photoshop inspector")
                check(not errors, f"workspace layout profiles threw exceptions: {errors[:3]}")

            def workspace_restore_precedence_and_inspector_sync():
                _, page, errors = app_page(browser)
                result = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('photoshop')
                    s.setDockWidth(385)
                    s.setRightPanelTab('properties')
                    const selectedUpper = window.__zphotoStore.getState().panels.photoshopInspector.upperTab === 'properties'
                    s.dockPanel('channels', 'right')
                    const selectedLower = window.__zphotoStore.getState().panels.photoshopInspector.lowerTab === 'channels'
                    s.revealPanel('histogram')
                    const revealedUpper = window.__zphotoStore.getState().panels.photoshopInspector.upperTab === 'histogram'
                    const snapshot = JSON.parse(localStorage.getItem('zphoto-workspace-layouts-v1'))
                    const recorded = snapshot.photoshop?.panels.dockWidth === 385
                    // Mimic a stale legacy global value left by an older version.
                    const legacy = JSON.parse(localStorage.getItem('zphoto-panel-layout'))
                    legacy.dockWidth = 220
                    legacy.rightTab = 'layers'
                    localStorage.setItem('zphoto-panel-layout', JSON.stringify(legacy))
                    return {selectedUpper, selectedLower, revealedUpper, recorded}
                }""")
                check(all(result.values()), f"Inspector navigation did not synchronize: {result}")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.workspacePreset") == "photoshop", "wrong workspace after reload")
                check(store(page, "s.panels.dockWidth") == 385,
                      "stale global panel layout overrode the active workspace's profile")
                check(store(page, "s.panels.photoshopInspector.upperTab") == "histogram",
                      "upper inspector tab was lost on reload")
                check(store(page, "s.panels.photoshopInspector.lowerTab") == "channels",
                      "lower inspector tab was lost on reload")
                check(not errors, f"workspace snapshot reloading threw JS errors: {errors[:3]}")

            def photoshop_inspector_tab_group_layout():
                _, page, errors = app_page(browser)
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('photoshop')
                    s.movePhotoshopInspectorTab('history', 'upper', 'adjustments')
                }""")
                check(store(page, "s.panels.photoshopInspector.upperTabs.slice(0,3).join(',')") ==
                      "color,history,adjustments", "store failed to reorder inspector tabs")
                check(not store(page, "s.panels.photoshopInspector.lowerTabs.includes('history')"),
                      "moving a tab copied it instead of moving it")
                # Real Chromium HTML drag-and-drop must update the live tab groups.
                page.locator('[data-inspector-tab="channels"]').drag_to(
                    page.locator('[data-inspector-tab="color"]'))
                check(store(page, "s.panels.photoshopInspector.upperTabs[0]") == "channels",
                      "pointer drag failed to move Channels into the upper inspector")
                check(not store(page, "s.panels.photoshopInspector.lowerTabs.includes('channels')"),
                      "pointer drag duplicated Channels between stacks")
                # Keyboard users can move tabs back without a drag.
                page.locator('[data-inspector-tab="channels"]').focus()
                before_up = store(page, "s.panels.photoshopInspector.upperTabs")
                page.keyboard.press("Alt+ArrowUp")
                check(store(page, "s.panels.photoshopInspector.upperTabs") == before_up,
                      "Alt+Up reordered a tab already in the upper inspector")
                page.keyboard.press("Alt+ArrowDown")
                check(store(page, "s.panels.photoshopInspector.lowerTabs.includes('channels')"),
                      "Alt+Down failed to move inspector tab to lower stack")
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.saveNamedLayout('Custom inspector tabs', 'panels')
                    s.setWorkspacePreset('classic')
                    s.setWorkspacePreset('photoshop')
                }""")
                check(store(page, "s.panels.photoshopInspector.upperTabs.includes('history')"),
                      "workspace switch lost moved inspector tabs")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.panels.photoshopInspector.upperTabs.includes('history')"),
                      "reload forgot custom inspector tab grouping")
                check(store(page, "s.panels.photoshopInspector.lowerTabs.includes('channels')"),
                      "reload forgot keyboard-moved inspector tab")
                saved = store(page, "JSON.parse(s.exportNamedLayout('Custom inspector tabs')).panels.photoshopInspector")
                check("history" in saved["upperTabs"] and "channels" in saved["lowerTabs"],
                      "export omitted inspector tab groups")
                page.get_by_role("button", name="Reset Photoshop inspector tab groups").click()
                check(store(page, "s.panels.photoshopInspector.upperTabs") ==
                      ["color", "adjustments", "properties", "navigator", "histogram"],
                      "Reset inspector tab groups did not restore Photoshop defaults")
                check(store(page, "s.savedLayouts.some(x => x.name === 'Custom inspector tabs')"),
                      "Resetting inspector tabs deleted a named layout")
                check(not errors, f"inspector grouping caused uncaught JS errors: {errors[:3]}")

            def photoshop_inspector_extra_panels_and_collapsed_routing():
                _, page, errors = app_page(browser)
                result = page.evaluate("""() => {
                    const st = window.__zphotoStore.getState()
                    st.setWorkspacePreset('photoshop')
                    st.resetWorkspaceLayout()
                    st.dockPanel('metadata', 'right')
                    const added = window.__zphotoStore.getState().panels.photoshopInspector.lowerTabs.includes('metadata')
                    st.movePhotoshopInspectorTab('metadata', 'upper', 'color')
                    st.setPhotoshopInspector({collapsed:true})
                    const inspector = window.__zphotoStore.getState().panels.photoshopInspector
                    return { added, moved:inspector.upperTabs[0] === 'metadata' &&
                        !inspector.lowerTabs.includes('metadata'), collapsed:inspector.collapsed }
                }""")
                check(all(result.values()), f"Failed to add external inspector panel: {result}")
                page.get_by_role("button", name="Show Metadata panel").click()
                check(store(page, "s.panels.photoshopInspector.upperTab") == "metadata",
                      "collapsed inspector routed moved Metadata tab to the lower stack")
                check(store(page, "s.panels.photoshopInspector.collapsed") is False,
                      "collapsed inspector failed to expand")
                page.evaluate("""() => {
                    const st = window.__zphotoStore.getState()
                    st.revealPanel('timeline')
                    st.revealPanel('timeline')
                    st.saveNamedLayout('Expanded Photoshop panels', 'panels')
                    st.setWorkspacePreset('classic')
                    st.setWorkspacePreset('photoshop')
                }""")
                check(store(page, "s.panels.photoshopInspector.lowerTabs.filter(id => id === 'timeline').length") == 1,
                      "Window panel reveal duplicated a tab")
                check(store(page, "s.panels.photoshopInspector.lowerTab") == "timeline",
                      "Window panel reveal didn't select the extra inspector tab")
                check(store(page, "s.panels.photoshopInspector.upperTabs[0]") == "metadata",
                      "switching workspaces lost custom upper inspector order")
                exported = store(page, "JSON.parse(s.exportNamedLayout('Expanded Photoshop panels')).panels.photoshopInspector")
                check("metadata" in exported["upperTabs"] and "timeline" in exported["lowerTabs"],
                      "named panel layout export lost additional inspector panels")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.panels.photoshopInspector.upperTabs[0]") == "metadata",
                      "reloading lost extra inspector panel")
                check(store(page, "s.panels.photoshopInspector.lowerTabs.includes('timeline')"),
                      "reloading lost extra Timeline panel")
                check(not errors, f"external inspector panel tests threw exceptions: {errors[:3]}")

            def photoshop_secondary_inspector_column():
                _, page, errors = app_page(browser)
                page.set_viewport_size({"width": 1440, "height": 900})
                result = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('photoshop')
                    s.resetWorkspaceLayout()
                    s.setPhotoshopInspector({ sideOpen: true, sideWidth: 335 })
                    s.movePhotoshopInspectorTab('history', 'side')
                    const i = window.__zphotoStore.getState().panels.photoshopInspector
                    return { sideOpen:i.sideOpen, moved:i.sideTabs.includes('history'),
                             removed:!i.lowerTabs.includes('history'), kept:i.lowerTabs.length > 0 }
                }""")
                check(all(result.values()), f"Second inspector column was not initialized correctly: {result}")
                page.wait_for_selector('[data-inspector-column="secondary"]')
                check(page.locator('[data-inspector-column="secondary"] [data-inspector-tab="history"]').count() == 1,
                      "History tab was not rendered in the second inspector column")
                check(store(page, "s.panels.photoshopInspector.sideWidth") == 335,
                      "Second inspector column lost its configured width")
                # Real drag-and-drop works across column boundaries.
                page.locator('[data-inspector-column="primary"] [data-inspector-tab="properties"]').drag_to(
                    page.locator('[data-inspector-column="secondary"] [data-inspector-tab="history"]'))
                check(store(page, "s.panels.photoshopInspector.sideTabs.includes('properties')"),
                      "Dragging a tab into the second column failed")
                page.locator('[data-inspector-column="secondary"] [data-inspector-tab="properties"]').focus()
                page.keyboard.press('Alt+ArrowUp')
                check(store(page, "s.panels.photoshopInspector.upperTabs.includes('properties')"),
                      "Alt+Up failed to return the dragged tab to the primary upper stack")
                # Real keyboard navigation can move a panel into and out of column 2.
                page.locator('[data-inspector-column="primary"] [data-inspector-tab="histogram"]').focus()
                page.keyboard.press('Alt+Shift+ArrowRight')
                check(store(page, "s.panels.photoshopInspector.sideTabs.includes('histogram')"),
                      "Alt+Shift+Right failed to move tab into the secondary column")
                page.locator('[data-inspector-column="secondary"] [data-inspector-tab="histogram"]').focus()
                page.keyboard.press('Alt+Shift+ArrowLeft')
                check(store(page, "s.panels.photoshopInspector.lowerTabs.includes('histogram')"),
                      "Alt+Shift+Left failed to move tab into lower stack")
                hidden = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setPhotoshopInspector({sideOpen:false})
                    s.setRightPanelTab('history')
                    const i = window.__zphotoStore.getState().panels.photoshopInspector
                    return {closed: !i.sideOpen, selected:i.sideTab === 'history'}
                }""")
                check(all(hidden.values()), f"Hidden second inspector unexpectedly reopened: {hidden}")
                check(page.locator('[data-inspector-column="secondary"]').count() == 0,
                      "Hidden second inspector column is still visible")
                check(page.locator('[data-photoshop-stack="lower"] [data-inspector-tab="history"]').count() == 1,
                      "Hidden column panel was not accessible in the lower stack")
                page.evaluate("""() => window.__zphotoStore.getState().setPhotoshopInspector({sideOpen:true})""")
                page.wait_for_selector('[data-inspector-column="secondary"]')
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.saveNamedLayout('Two-column inspector', 'panels')
                    s.setWorkspacePreset('classic')
                    s.setWorkspacePreset('photoshop')
                }""")
                check(store(page, "s.panels.photoshopInspector.sideTabs.includes('history')"),
                      "Switching workspaces lost the second inspector column's panel tabs")
                check(store(page, "s.panels.photoshopInspector.sideWidth") == 335,
                      "Switching workspaces lost the second inspector column width")
                exported = store(page, "JSON.parse(s.exportNamedLayout('Two-column inspector')).panels.photoshopInspector")
                check(exported["sideTabs"] == ["history"] and exported["sideOpen"] and exported["sideWidth"] == 335,
                      "Named layout export did not preserve the secondary inspector column")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                page.wait_for_selector('[data-inspector-column="secondary"]')
                check(store(page, "s.panels.photoshopInspector.sideTabs") == ["history"],
                      "Reload forgot the secondary inspector group")
                # When the viewport cannot fit two columns, tabs remain available
                # through the existing lower stack rather than disappearing.
                page.set_viewport_size({"width": 900, "height": 700})
                page.wait_for_function("""() => document.querySelector('[data-photoshop-dock]')
                    ?.getAttribute('data-secondary-visible') === 'false'""")
                check(page.locator('[data-inspector-column="secondary"]').count() == 0,
                      "Secondary column rendered over the canvas in a narrow window")
                check(page.locator('[data-photoshop-stack="lower"] [data-inspector-tab="history"]').count() == 1,
                      "Narrow viewport stranded the hidden second-column panel")
                page.set_viewport_size({"width": 1440, "height": 900})
                page.wait_for_selector('[data-inspector-column="secondary"]')
                check(store(page, "s.panels.photoshopInspector.sideWidth") == 335,
                      "Responsive fallback changed the persistent column width")
                page.get_by_role("button", name="Reset Photoshop inspector tab groups").click()
                check(store(page, "s.panels.photoshopInspector.sideTabs") == [],
                      "Inspector group reset left an orphaned secondary column tab")
                check(store(page, "s.panels.photoshopInspector.sideOpen") is False,
                      "Inspector group reset didn't close the secondary column")
                check(store(page, "s.panels.rightTab") == "layers",
                      "Inspector group reset left a hidden panel selected")
                check(store(page, "s.savedLayouts.some(x => x.name === 'Two-column inspector')"),
                      "Inspector group reset deleted the saved two-column preset")
                legacy = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    const old = JSON.parse(s.exportNamedLayout('Two-column inspector'))
                    old.name = 'Legacy one-column profile'
                    delete old.panels.photoshopInspector.sideTabs
                    delete old.panels.photoshopInspector.sideTab
                    delete old.panels.photoshopInspector.sideOpen
                    delete old.panels.photoshopInspector.sideWidth
                    const name = s.importNamedLayout(JSON.stringify(old))
                    s.applyNamedLayout(name)
                    const i = window.__zphotoStore.getState().panels.photoshopInspector
                    return {empty:i.sideTabs.length === 0, hidden:!i.sideOpen,
                        defaultWidth:i.sideWidth === 280, primaryTabs:i.upperTabs.length > 0 && i.lowerTabs.length > 0}
                }""")
                check(all(legacy.values()), f"Legacy single-column layout migration failed: {legacy}")
                check(not errors, f"secondary inspector caused JavaScript errors: {errors[:3]}")

            def workspace_layout_lock_isolation():
                _, page, errors = app_page(browser)
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('photoshop')
                    s.resetWorkspaceLayout()
                    s.saveNamedLayout('Before lock', 'both')
                }""")
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("menuitem", name="Lock panels layout").click()
                page.get_by_role("menuitem", name="Lock tools layout").click()
                page.keyboard.press("Escape")  # close modal dropdown before inspecting the workspace
                check(store(page, "s.workspaceLayoutLocks.photoshop") == {"tools": True, "panels": True},
                      "Workspace menu did not independently lock both layouts")
                check(page.locator('[data-inspector-tab="color"]').get_attribute("draggable") == "false",
                      "Locked Photoshop tabs are still draggable")
                check(page.locator('[aria-label="Resize Photoshop inspector groups"]').get_attribute("aria-disabled") == "true",
                      "Locked inspector splitter is still enabled")
                check(page.get_by_role("button", name="Arrange panels for the right dock").is_disabled(),
                      "Locked inspector still offers the Add Panel rearrangement menu")
                page.locator('[data-inspector-tab="color"]').click(button="right")
                check(page.get_by_role("menuitem", name="Float panel").is_disabled(),
                      "Context menu still allows floating a panel when layout is locked")
                page.keyboard.press("Escape")
                blocked = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    const before = JSON.stringify({panels:s.panels, toolbar:s.toolbarLayout})
                    s.movePhotoshopInspectorTab('history', 'side')
                    s.setPhotoshopInspector({upperPercent:65, sideWidth:410, sideOpen:true})
                    s.setRightPanelTab('metadata') // cannot silently append an unlisted panel while locked
                    s.revealPanel('metadata')
                    s.floatPanel('history')
                    s.dockPanel('color', 'left')
                    s.setDockWidth(420)
                    s.setToolbarLayout([{kind:'single', tool:'eraser'}])
                    s.resetToolbarLayout()
                    s.resetPanelLayout()
                    s.resetWorkspaceLayout()
                    let applyRejected = false
                    try { s.applyNamedLayout('Before lock') }
                    catch { applyRejected = true }
                    const unchanged = JSON.stringify({
                       panels:window.__zphotoStore.getState().panels,
                       toolbar:window.__zphotoStore.getState().toolbarLayout
                    }) === before
                    s.setTool('brush')
                    s.setRightPanelTab('history')
                    const selected = window.__zphotoStore.getState().activeTool === 'brush' &&
                       window.__zphotoStore.getState().panels.rightTab === 'history'
                    return {unchanged, selected, applyRejected}
                }""")
                check(all(blocked.values()), f"Workspace lock allowed a layout mutation: {blocked}")
                # Classic is independently unlocked, so it can be customized.
                switched = page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('classic')
                    const unlocked = !window.__zphotoStore.getState().workspaceLayoutLocks.classic.tools &&
                                     !window.__zphotoStore.getState().workspaceLayoutLocks.classic.panels
                    s.setDockWidth(365)
                    s.setToolbarLayout([{kind:'single', tool:'eraser'}])
                    const classicChanged = window.__zphotoStore.getState().panels.dockWidth === 365 &&
                                          window.__zphotoStore.getState().toolbarLayout?.[0]?.tool === 'eraser'
                    s.setWorkspacePreset('photoshop')
                    return {unlocked, classicChanged}
                }""")
                check(all(switched.values()), f"Locks leaked across workspaces: {switched}")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.workspaceLayoutLocks.photoshop") == {"tools": True, "panels": True},
                      "Layout locks did not survive reload")
                check(store(page, "s.workspaceLayoutLocks.classic") == {"tools": False, "panels": False},
                      "Reload unexpectedly locked Classic")
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("menuitem", name="Unlock panels layout").click()
                page.get_by_role("menuitem", name="Unlock tools layout").click()
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.movePhotoshopInspectorTab('history', 'side')
                    s.setToolbarLayout([{kind:'single', tool:'eraser'}])
                }""")
                check(store(page, "s.panels.photoshopInspector.sideTabs.includes('history')"),
                      "Unlock did not restore panel rearrangement")
                check(store(page, "s.toolbarLayout?.[0]?.tool") == "eraser",
                      "Unlock did not restore toolbar customization")
                check(not errors, f"workspace locks generated JavaScript errors: {errors[:3]}")

            def floating_window_layout_lock_during_drag():
                _, page, errors = app_page(browser)
                page.evaluate("""() => {
                    const s = window.__zphotoStore.getState()
                    s.setWorkspacePreset('photoshop')
                    s.resetWorkspaceLayout()
                    s.floatPanel('history', {x:320, y:170, w:280, h:300})
                }""")
                frame = page.locator('[data-floating-panel="history"]')
                handle = frame.locator('.panel-window-titlebar')
                box = handle.bounding_box()
                check(box is not None, "Floating panel title bar unavailable")
                initial = frame.evaluate("(node) => ({left:parseFloat(node.style.left), top:parseFloat(node.style.top)})")
                page.mouse.move(box["x"] + 75, box["y"] + 12)
                page.mouse.down()
                page.mouse.move(box["x"] + 120, box["y"] + 48, steps=4)
                page.evaluate("""() => window.__zphotoStore.getState().setWorkspaceLayoutLock('panels', true)""")
                page.mouse.move(box["x"] + 160, box["y"] + 70, steps=3)
                page.mouse.up()
                after = frame.evaluate("(node) => ({left:parseFloat(node.style.left), top:parseFloat(node.style.top)})")
                check(abs(after["left"] - initial["left"]) <= 2 and
                      abs(after["top"] - initial["top"]) <= 2,
                      f"Locking while dragging left stale unsaved DOM geometry: {initial} -> {after}")
                check(store(page, "s.panels.floating.history.x") == 320 and
                      store(page, "s.panels.floating.history.y") == 170,
                      "Locked floating window committed moved geometry")
                check(frame.locator('div[aria-hidden][class*="cursor-"][class*="resize"]').count() == 0,
                      "Locked floating panel still offers resize handles")
                page.evaluate("""() => window.__zphotoStore.getState().setWorkspaceLayoutLock('panels', false)""")
                box = handle.bounding_box()
                check(box is not None, "Floating panel disappeared after unlocking")
                page.mouse.move(box["x"] + 75, box["y"] + 12)
                page.mouse.down()
                page.mouse.move(box["x"] + 115, box["y"] + 42, steps=4)
                page.evaluate("""() => window.__zphotoStore.getState().setWorkspaceLayoutLock('panels', true)""")
                # No movement event after enabling the lock; pointer-up itself
                # must restore unsaved DOM geometry.
                page.mouse.up()
                final = frame.evaluate("(node) => ({left:parseFloat(node.style.left), top:parseFloat(node.style.top)})")
                check(abs(final["left"] - initial["left"]) <= 2 and
                      abs(final["top"] - initial["top"]) <= 2,
                      f"Pointer release after a mid-drag lock left shifted DOM: {final}")
                check(not errors, f"floating panel lock caused JavaScript errors: {errors[:3]}")

            def named_layout_manager_safety():
                _, page, errors = app_page(browser)
                seed = page.evaluate("""() => {
                    const st = window.__zphotoStore.getState()
                    st.saveNamedLayout('Layout alpha', 'both')
                    st.saveNamedLayout('Layout beta', 'tools')
                    let collisionRejected = false
                    try { st.renameNamedLayout('Layout alpha', 'Layout beta') }
                    catch { collisionRejected = true }
                    const unmodified = window.__zphotoStore.getState().savedLayouts.some(x => x.name === 'Layout alpha')
                    const prototype = Storage.prototype
                    const original = prototype.setItem
                    let rejected = false
                    try {
                      prototype.setItem = function(key, value) {
                        if (key === 'zphoto-saved-layouts-v1') throw new DOMException('No storage', 'QuotaExceededError')
                        return original.call(this, key, value)
                      }
                      try { st.saveNamedLayout('Should never appear', 'tools') }
                      catch (e) { rejected = String(e).includes('Unable to save layouts') }
                    } finally { prototype.setItem = original }
                    const inMemorySafe = !window.__zphotoStore.getState().savedLayouts.some(x => x.name === 'Should never appear')
                    return {collisionRejected, unmodified, rejected, inMemorySafe}
                }""")
                check(all(seed.values()), f"Saved layout transactional operations failed: {seed}")
                page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("button", name="Delete Layout alpha").click()
                # First click must only request confirmation.
                check(store(page, "s.savedLayouts.some(x => x.name === 'Layout alpha')"),
                      "delete button removed a preset without confirmation")
                page.get_by_role("button", name="Cancel deleting Layout alpha").click()
                check(store(page, "s.savedLayouts.some(x => x.name === 'Layout alpha')"),
                      "cancelling deletion lost the preset")
                page.get_by_role("button", name="Rename Layout alpha").click()
                page.get_by_role("textbox", name="Layout name").fill("Layout gamma")
                page.get_by_role("menuitem", name="Rename saved layout").click()
                check(store(page, "s.savedLayouts.some(x => x.name === 'Layout gamma')"),
                      "renaming did not update the saved layout")
                check(not store(page, "s.savedLayouts.some(x => x.name === 'Layout alpha')"),
                      "rename left behind a duplicate old name")
                if not page.get_by_role("button", name="Delete Layout gamma").is_visible():
                    page.get_by_role("button", name="Workspace template").click()
                page.get_by_role("button", name="Delete Layout gamma").click()
                page.get_by_role("button", name="Confirm delete Layout gamma").click()
                check(not store(page, "s.savedLayouts.some(x => x.name === 'Layout gamma')"),
                      "confirmed deletion did not remove the preset")
                page.reload()
                page.wait_for_function("() => !!window.__zphotoStore")
                check(store(page, "s.savedLayouts.some(x => x.name === 'Layout beta')"),
                      "reload lost the untouched named layout")
                check(not store(page, "s.savedLayouts.some(x => x.name === 'Layout gamma')"),
                      "deleted layout unexpectedly survived reload")
                check(not errors, f"named layout management threw JavaScript exceptions: {errors[:3]}")

            def editable_layer_context_menu():
                _, page, errors = app_page(browser)
                page.evaluate("""() => {
                    window.__zphotoEngine.newDocument({
                        name: 'Context menu smoke', width: 80, height: 80, fill: 'white'
                    })
                    window.__zphotoStore.getState().setTool('move')
                }""")
                page.wait_for_function("() => !!window.__zphotoEngine.activeDoc?.activeLayerId")
                host = page.locator('div.absolute.inset-0.touch-none').first
                host.click(button="right")
                page.get_by_role("menuitem", name=re.compile("Edit context menu", re.I)).click()
                dialog = page.get_by_role("dialog", name="Edit right-click menu")
                dialog.wait_for(state="visible", timeout=10000)
                dialog.get_by_role("checkbox", name="Show Free Transform").uncheck()
                dialog.get_by_role("button", name="Move Paste Layer up").click()
                state = page.evaluate("""() => JSON.parse(
                    localStorage.getItem('zphoto-layer-context-menu-v1')
                )""")
                check('transform' in state["hidden"], "visibility toggle was not persisted")
                check(state["order"]["edit"] == ['undo', 'redo', 'paste', 'cut'],
                      f"reorder did not persist: {state['order']['edit']}")
                dialog.get_by_role("button", name="Done").click()
                dialog.wait_for(state="hidden")
                page.wait_for_timeout(400)  # let Radix menu/dialog focus restore
                host.click(button="right")
                menu = page.get_by_role("menu", name=re.compile("Layer actions"))
                check(menu.get_by_role("menuitem", name=re.compile("Free Transform")).count() == 0,
                      "hidden transform command still appeared")
                # The panel must share visibility/order and the editor, not a legacy hardcoded menu.
                page.keyboard.press("Escape")
                page.evaluate("() => window.__zphotoEngine.addRasterLayer('Top test layer')")
                page.wait_for_function("() => window.__zphotoEngine.activeDoc.layers.length >= 2")
                page.wait_for_timeout(300)
                # Right-click the non-active bottom row: context commands must target it.
                bottom_id = page.evaluate("() => window.__zphotoEngine.activeDoc.layers[0].id")
                layer_row = page.get_by_role("list", name="Layers").get_by_role("listitem").last
                layer_row.click(button="right")
                check(page.evaluate("() => window.__zphotoEngine.activeDoc.activeLayerId") == bottom_id,
                      "right-clicking a different row did not focus its layer")
                panel_menu = page.get_by_role("menu", name=re.compile("Layer actions"))
                check(panel_menu.get_by_role("menuitem", name=re.compile("Free Transform")).count() == 0,
                      "Layers panel ignored hidden canvas action")
                check(panel_menu.get_by_role("menuitem", name=re.compile("Add Mask from Selection")).count() == 1,
                      "Layers panel lost its mask actions")
                panel_menu.get_by_role("menuitem", name=re.compile("Edit context menu", re.I)).click()
                dialog = page.get_by_role("dialog", name="Edit right-click menu")
                dialog.wait_for(state="visible")
                dialog.get_by_role("checkbox", name="Show Free Transform").check()
                dialog.get_by_role("button", name="Done").click()
                dialog.wait_for(state="hidden")
                page.wait_for_timeout(400)
                host.click(button="right")
                check(page.get_by_role("menuitem", name=re.compile("Free Transform")).count() == 1,
                      "Canvas menu did not update after panel editor change")
                page.get_by_role("menuitem", name=re.compile("Edit context menu", re.I)).click()
                dialog = page.get_by_role("dialog", name="Edit right-click menu")
                dialog.get_by_role("button", name="Reset defaults").click()
                reset = page.evaluate("""() => JSON.parse(
                    localStorage.getItem('zphoto-layer-context-menu-v1')
                )""")
                check(not reset["hidden"] and reset["order"]["edit"] == ['undo', 'redo', 'cut', 'paste'],
                      "reset did not restore all menu defaults")
                dialog.get_by_role("button", name="Done").click()
                check(not errors, f"context menu customizer threw JavaScript errors: {errors[:3]}")

            def png_import_undo_redo():
                _, page, errors = app_page(browser)
                check(page.locator('input[data-file-purpose="document"]').count() >= 1,
                      "Document file picker not mounted")
                check(page.locator('input[data-file-purpose="layout"]').count() == 1,
                      "Layout import picker not mounted independently")
                page.locator('input[data-file-purpose="document"]').first.set_input_files(
                    {"name": "chromium-smoke.png", "mimeType": "image/png", "buffer": pixel_png()})
                page.wait_for_function("() => !!window.__zphotoEngine.activeDoc && window.__zphotoEngine.activeDoc.width === 8", timeout=30000)
                value = page.evaluate("""() => {
                  const e = window.__zphotoEngine, doc = e.activeDoc
                  const initial = doc.layers.length
                  const c = document.createElement('canvas')
                  c.width = 8; c.height = 8
                  const cx = c.getContext('2d')
                  cx.fillStyle = '#e33a77'; cx.fillRect(0, 0, 8, 8)
                  e.addLayerFromCanvas(c, 'Chromium E2E layer')
                  const added = doc.layers.length
                  e.undo()
                  const afterUndo = doc.layers.length
                  e.redo()
                  return { width: doc.width, height: doc.height, initial, added, afterUndo, afterRedo: doc.layers.length }
                }""")
                print("  PNG/history:", value, flush=True)
                check(value["initial"] >= 1 and value["added"] == value["initial"] + 1,
                      "add-layer did not increment document layers")
                check(value["afterUndo"] == value["initial"], "undo did not remove added layer")
                check(value["afterRedo"] == value["added"], "redo did not restore added layer")
                check(not errors, f"image import/history threw uncaught errors: {errors[:3]}")

            def video_frame_picker():
                _, page, errors = app_page(browser)
                upload = {"name": "two-tone.webm", "mimeType": "video/webm",
                          "buffer": video_fixture()}
                file_input = page.locator('input[data-file-purpose="document"]').first
                initial_count = page.evaluate("() => window.__zphotoEngine.docs.length")
                file_input.set_input_files(upload)
                dialog = page.get_by_role("dialog", name="Import frame from video")
                dialog.wait_for(state="visible", timeout=30000)
                video = dialog.locator("video[data-video-preview]")
                expect(dialog.locator("input[data-video-time]")).to_be_enabled(timeout=15000)
                page.wait_for_function("""() => {
                  const v = document.querySelector('[data-video-preview]')
                  return !!v && v.videoWidth === 80 && v.videoHeight === 60 && v.readyState >= 2
                }""", timeout=20000)
                timestamp = dialog.locator("input[data-video-time]")
                timestamp.fill("1.5")
                timestamp.press("Tab")
                page.wait_for_function("""() => {
                  const v = document.querySelector('[data-video-preview]')
                  const b = document.querySelector('[data-video-import]')
                  return !!v && Math.abs(v.currentTime - 1.5) < 0.1 &&
                    !v.seeking && !!b && !b.disabled
                }""", timeout=20000)
                preview = video.evaluate("""video => {
                  const c = document.createElement('canvas')
                  c.width = 80; c.height = 60
                  const cx = c.getContext('2d')
                  cx.drawImage(video, 0, 0)
                  return Array.from(cx.getImageData(40, 30, 1, 1).data)
                }""")
                check(preview[2] > 140 and preview[0] < 100,
                      f"selected 1.5-second frame must be blue: {preview}")
                dialog.locator('button[data-video-import]').click()
                dialog.wait_for(state="hidden", timeout=10000)
                page.wait_for_function("""count => {
                  const e = window.__zphotoEngine
                  return e.docs.length === count + 1 && e.activeDoc?.width === 80 &&
                    e.activeDoc?.height === 60
                }""", arg=initial_count, timeout=20000)
                imported = page.evaluate("""() => {
                  const l = window.__zphotoEngine.activeDoc.layers[0]
                  return Array.from(l.canvas.getContext('2d').getImageData(40, 30, 1, 1).data)
                }""")
                check(imported[2] > 140 and imported[0] < 100,
                      f"imported document did not retain selected blue frame: {imported}")
                file_input.set_input_files(upload)
                dialog.wait_for(state="visible", timeout=30000)
                dialog.locator("button[data-video-cancel]").click()
                dialog.wait_for(state="hidden", timeout=10000)
                page.wait_for_timeout(400)
                check(page.evaluate("() => window.__zphotoEngine.docs.length") == initial_count + 1,
                      "cancelling a video should not create a document")
                check(not errors, f"video frame picker caused uncaught errors: {errors[:3]}")

            def pdf_multi_page_import():
                _, page, errors = app_page(browser)
                page.locator('input[data-file-purpose="document"]').first.set_input_files(
                    {"name": "two-pages.pdf", "mimeType": "application/pdf", "buffer": pdf_fixture()})
                dialog = page.get_by_role("dialog", name="Select PDF pages to import")
                dialog.wait_for(state="visible", timeout=30000)
                dialog.get_by_role("combobox", name="PDF page import mode").select_option("all")
                dialog.get_by_role("button", name="Import").click()
                page.wait_for_function("""() => {
                    const d = window.__zphotoEngine?.activeDoc
                    return !!d && d.name.includes('two-pages') &&
                      d.width === 400 && d.height === 240 && d.layers?.length >= 2
                }""", timeout=45000)
                data = page.evaluate("""() => {
                  const d = window.__zphotoEngine.activeDoc
                  return {
                    name: d.name, width: d.width, height: d.height,
                    layers: d.layers.map(l => ({
                      name: l.name, visible: l.visible, width: l.canvas?.width,
                      pixel: l.canvas ? Array.from(l.canvas.getContext('2d').getImageData(
                        200, 170, 1, 1).data) : null,
                    }))
                  }
                }""")
                print("  PDF import:", data, flush=True)
                check({l["name"] for l in data["layers"] if "Visual reference" in l["name"]} ==
                      {"PDF Page 1 · Visual reference", "PDF Page 2 · Visual reference"}, "PDF page references not imported distinctly")
                reds = [l for l in data["layers"] if l["name"] == "PDF Page 1 · Visual reference"]
                blues = [l for l in data["layers"] if l["name"] == "PDF Page 2 · Visual reference"]
                check(len(reds) == 1 and reds[0]["pixel"][0] > 210 and reds[0]["pixel"][2] < 80,
                      "PDF.js must render page 1 red vector rectangle")
                check(len(blues) == 1 and blues[0]["pixel"][2] > 210 and blues[0]["pixel"][0] < 80,
                      "PDF.js must render page 2 blue vector rectangle")
                check(len(data["layers"]) > 2, "PDF native vector extraction should expose editable shapes")
                check(bool(reds[0]["visible"]) and not bool(blues[0]["visible"]),
                      "first PDF page should be visible and second hidden")
                check(not errors, f"PDF import threw JavaScript errors: {errors[:3]}")

            def real_psd_browser_import():
                _, page, errors = app_page(browser)
                upstream = "b58704c1c9c9b2459f961560b1e368dfb102b513"
                for name, expected_sha, is_smart in [
                    ("pixel-layer.psd", "0d3ee59728ebd8237e4c2c8eee1997e42e3ee82d", False),
                    ("type-layer.psd", "1cdcf08f88b103a50b74de7f3b70a7ccf63122e5", False),
                    ("smartobject-layer.psd", "924e5866581b25ffa1d2cbc8cbf34217929e4295", True),
                ]:
                    url = (f"https://raw.githubusercontent.com/psd-tools/psd-tools/{upstream}"
                           f"/tests/psd_files/layers/{name}")
                    with urllib.request.urlopen(url, timeout=25) as response:
                        content = response.read()
                    git_sha = hashlib.sha1(b"blob " + str(len(content)).encode() + bytes([0]) + content).hexdigest()
                    check(git_sha == expected_sha, f"Independent {name} binary changed")
                    # Exercise the complete real PSD binary->native-guides UI
                    # path by inserting a standards-compliant Adobe resource
                    # 1032 into a verified independent PSD. The image/layers
                    # remain those of the real upstream Photoshop fixture.
                    if name == "pixel-layer.psd":
                        color_length = struct.unpack_from(">I", content, 26)[0]
                        resource_len_at = 30 + color_length
                        old_len = struct.unpack_from(">I", content, resource_len_at)[0]
                        guide_data = struct.pack(">IIII", 1, 576, 576, 2)
                        guide_data += struct.pack(">IBIB", 400, 0, 200, 1)
                        guide_resource = b"8BIM" + struct.pack(">H", 1032) + bytes(2)
                        guide_resource += struct.pack(">I", len(guide_data)) + guide_data
                        path_data = struct.pack(">H", 6) + bytes(24)
                        path_data += struct.pack(">HH", 3, 2) + bytes(22)
                        for x, y in [(8, 12), (24, 18)]:
                            fixed_x = x * (1 << 19)  # fixed 8.24 normalized by width=32
                            fixed_y = y * (1 << 19)
                            path_data += struct.pack(">Hiiiiii", 5,
                                fixed_y, fixed_x, fixed_y, fixed_x, fixed_y, fixed_x)
                        path_name = b"Vector trail"
                        path_resource = (b"8BIM" + struct.pack(">H", 2000) +
                            bytes([len(path_name)]) + path_name + bytes(1) +
                            struct.pack(">I", len(path_data)) + path_data)
                        added_resources = guide_resource + path_resource
                        content = (content[:resource_len_at] +
                                   struct.pack(">I", old_len + len(added_resources)) +
                                   added_resources + content[resource_len_at + 4:])
                    previous_doc_id = page.evaluate(
                        "() => window.__zphotoEngine.activeDoc?.id ?? null")
                    page.locator('input[data-file-purpose="document"]').first.set_input_files(
                        {"name": name, "mimeType": "image/vnd.adobe.photoshop", "buffer": content})
                    page.wait_for_function("""previousId => {
                      const doc = window.__zphotoEngine.activeDoc
                      return doc && doc.id !== previousId &&
                        doc.width === 32 && doc.height === 32 && doc.layers.length === 1
                    }""", arg=previous_doc_id, timeout=30000)
                    result = page.evaluate("""() => {
                      const doc = window.__zphotoEngine.activeDoc
                      const layer = doc.layers[0]
                      const image = layer.kind === 'smart' ? layer.source : layer.canvas
                      const pixels = image?.getContext('2d')?.getImageData(0, 0, image.width, image.height).data
                      const rendered = window.__zphotoEngine.layerCanvas(layer.id)
                      return {
                        width: doc.width, height: doc.height, layers: doc.layers.length,
                        layerName: layer.name, kind: layer.kind,
                        smartOrigin: layer.psdNativeOrigin?.kind === 'smart',
                        sourcePixels: pixels?.length ?? 0,
                        guides: doc.guides?.map(g => ({ orientation: g.orientation, pos: g.pos })) ?? [],
                        paths: doc.savedPaths?.map(p => ({
                          name: p.name, closed: p.closed, psdPathResourceId: p.psdPathResourceId,
                          knots: p.anchors.map(a => [a.x, a.y]),
                        })) ?? [],
                        rendered: !!rendered && rendered.width > 0 && rendered.height > 0,
                        smartDocSized: !!rendered && rendered.width === doc.width && rendered.height === doc.height,
                      }
                    }""")
                    print(f"  Real {name} browser import: {result}", flush=True)
                    check(result["kind"] == ("smart" if is_smart else "raster") and
                          result["sourcePixels"] > 0 and result["rendered"],
                          f"Real {name} did not produce the expected editable layer and canvas")
                    if name == "pixel-layer.psd":
                        check(result["guides"] == [
                            {"orientation": "v", "pos": 12.5},
                            {"orientation": "h", "pos": 6.25},
                        ], f"Photoshop native guides were not restored into the editor: {result['guides']}")
                        check(result["paths"] == [{
                            "name": "Vector trail", "closed": False, "psdPathResourceId": 2000,
                            "knots": [[8, 12], [24, 18]],
                        }], f"Photoshop editable saved paths were not restored: {result['paths']}")
                    if is_smart:
                        check(result["smartOrigin"] and result["smartDocSized"],
                              "Photoshop Smart Object lost its descriptor provenance or document-space rendering")
                check(not errors, f"real PSD browser imports threw JS errors: {errors[:3]}")

            def gimp_lazy_interpreters():
                _, page, errors = app_page(browser, track_workers=True)
                requests = []
                page.on("request", lambda request: requests.append(request.url))
                initial = page.evaluate("() => window.__workerTestRecord.created")
                page.evaluate("() => window.__zphotoStore.getState().openDialog('plugin-manager')")
                page.get_by_role("dialog").wait_for(state="visible", timeout=30000)
                page.get_by_role("tab", name="GIMP Scripts").click()
                source = page.get_by_role("textbox", name="GIMP script source")
                source.wait_for(state="visible", timeout=30000)
                source.fill("gimp-drawable-levels")
                page.get_by_role("button", name="Analyze source").click()
                page.get_by_text("gimp-drawable-levels", exact=True).last.wait_for(state="visible")
                check(page.evaluate("() => window.__workerTestRecord.created") == initial,
                      "static GIMP source analysis unexpectedly started a Worker")
                page.get_by_role("tab", name="GIMP Runtime").click()
                page.get_by_role("button", name="Detect GIMP 3").wait_for(state="visible")
                check(page.evaluate("() => window.__workerTestRecord.created") == initial,
                      "opening GIMP Runtime unexpectedly started a Worker")
                check(not any("pyodide" in url.lower() or "jsdelivr" in url.lower() for url in requests),
                      "opening GIMP tools downloaded the Python interpreter")
                page.get_by_role("tab", name="GIMP Scripts").click()
                source.fill("(+ 1 2)")
                page.locator('label:has-text("Runtime") select').first.select_option("scheme")
                # Only the explicit Run action may start Scheme. No Pyodide network fetch.
                check(page.evaluate("() => window.__workerTestRecord.created") == initial,
                      "choosing a Scheme interpreter loaded it before Run")
                page.get_by_role("button", name="Run embedded code").click()
                output = page.get_by_label("Interpreter output")
                output.wait_for(state="visible", timeout=15000)
                check(output.inner_text().strip() == "3",
                      f"Scheme calculation produced an unexpected result: {output.inner_text()}")
                page.wait_for_function("(initial) => window.__workerTestRecord.terminated > initial", arg=initial,
                                       timeout=10000)
                counts = page.evaluate("() => window.__workerTestRecord")
                check(counts["created"] == initial + 1 and counts["terminated"] >= 1,
                      f"Scheme must create and clean up exactly one worker: {counts}")
                check(not any("pyodide" in url.lower() or "jsdelivr" in url.lower() for url in requests),
                      "running Scheme incorrectly downloaded Pyodide")
                check(not errors, f"GIMP script UI produced JavaScript errors: {errors[:3]}")
                print("  GIMP lazy-load workers:", counts, flush=True)

            def color_sampler_info_panel():
                _, page, errors = app_page(browser)
                page.evaluate("""() => {
                  const e = window.__zphotoEngine
                  e.newDocument({name: 'Sampler smoke', width: 16, height: 16, fill: 'transparent'})
                  e.addColorSampler(2, 3)
                  window.__zphotoStore.getState().setRightPanelTab('info')
                }""")
                panel = page.get_by_label("Info panel")
                panel.wait_for(state="visible", timeout=20000)
                check(panel.get_by_text("Transparent", exact=True).count() >= 1,
                      "fully transparent pixel was displayed as a black HEX color")
                check(panel.get_by_text("No sampled color", exact=False).count() >= 1,
                      "transparent sample must have no made-up RGB/Lab/CMYK values")
                x_input = panel.get_by_role("spinbutton", name="Sampler 1 X coordinate")
                y_input = panel.get_by_role("spinbutton", name="Sampler 1 Y coordinate")
                x_input.fill("5.3")
                x_input.press("Enter")
                check(abs(page.evaluate("() => window.__zphotoEngine.activeDoc.colorSamplers[0].x") - 5.3) < .001,
                      "numeric X coordinate was not saved")
                y_input.fill("5")
                y_input.press("Enter")
                check(page.evaluate("() => window.__zphotoEngine.activeDoc.colorSamplers[0].y") == 5,
                      "numeric Y coordinate was not saved")
                # Use a real editor document operation: direct edits to the backing
                # HTMLCanvasElement bypass render cache invalidation and cannot
                # represent an ordinary painting operation.
                page.evaluate("""() => {
                  const e = window.__zphotoEngine
                  e.newDocument({name: 'Colored sampler smoke',
                                 width: 16, height: 16, fill: '#12ab34'})
                  e.addColorSampler(5.3, 5)
                }""")
                panel.get_by_text("#12AB34").wait_for(state="visible", timeout=10000)
                with page.expect_download() as download_event:
                    panel.get_by_role("button", name="CSV").first.click()
                export = download_event.value
                csv = Path(export.path()).read_text(encoding="utf-8")
                check("12AB34" in csv and '"5.30"' in csv and '"Current Layer"' not in csv,
                      f"sample CSV did not preserve data/source: {csv[:260]}")
                check(export.suggested_filename.endswith("-color-samplers.csv"),
                      "sampler export filename was incorrect")
                check(not errors, f"Info panel caused JavaScript errors: {errors[:3]}")

            def mobile_start():
                _, page, errors = app_page(browser, size=(430, 850))
                check(page.locator("body").bounding_box()["width"] <= 431,
                      "mobile viewport overflows horizontally")
                page.evaluate("() => window.__zphotoEngine.newDocument({ name: 'Mobile smoke', width: 80, height: 70, fill: 'white' })")
                page.wait_for_function("() => !!window.__zphotoEngine.activeDoc && window.__zphotoEngine.activeDoc.width === 80")
                check(not errors, f"mobile editor threw uncaught errors: {errors[:3]}")

            for name, fn in [
                ("editor_startup", startup),
                ("eight_dock_routes", all_routes),
                ("dock_resize_reset_persistence", resize_reset),
                ("dock_context_move_float", context_float),
                ("workspace_all_tools_dialog", workspace_and_dialog),
                ("workspace_layout_profiles", workspace_layout_profiles),
                ("workspace_restore_precedence_and_inspector_sync", workspace_restore_precedence_and_inspector_sync),
                ("photoshop_inspector_tab_group_layout", photoshop_inspector_tab_group_layout),
                ("photoshop_inspector_extra_panels_and_collapsed_routing", photoshop_inspector_extra_panels_and_collapsed_routing),
                ("photoshop_secondary_inspector_column", photoshop_secondary_inspector_column),
                ("workspace_layout_lock_isolation", workspace_layout_lock_isolation),
                ("floating_window_layout_lock_during_drag", floating_window_layout_lock_during_drag),
                ("named_layout_manager_safety", named_layout_manager_safety),
                ("editable_layer_context_menu", editable_layer_context_menu),
                ("color_sampler_info_panel", color_sampler_info_panel),
                ("png_import_layer_undo_redo", png_import_undo_redo),
                ("video_frame_picker_real_webm", video_frame_picker),
                ("real_psd_chromium_import", real_psd_browser_import),
                ("pdf_two_page_vector_render", pdf_multi_page_import),
                ("gimp_lazy_interpreters", gimp_lazy_interpreters),
                ("mobile_editor_startup", mobile_start),
            ]:
                run_test(name, fn)
        finally:
            browser.close()
    passed = sum(good for _, good, _ in RESULTS)
    print(f"\nChromium E2E result: {passed}/{len(RESULTS)} passed", flush=True)
    for name, good, message in RESULTS:
        if not good:
            print(f"  - {name}: {message}", flush=True)
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
