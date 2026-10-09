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
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

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


def app_page(browser, size=(1440, 900)):
    global ACTIVE_PAGE
    context = browser.new_context(viewport={"width": size[0], "height": size[1]},
                                  service_workers="block", accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    resp = page.goto(APP_URL, wait_until="domcontentloaded", timeout=60000)
    check(resp is not None and resp.status == 200, "exported application did not return HTTP 200")
    page.wait_for_function(
        "() => !!window.__zphotoStore && !!window.__zphotoEngine && !!document.querySelector('[data-panel-dock]')",
        timeout=60000,
    )
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
                dest = page.locator('[data-panel-dock="bottom-right"] [title*="Open Files"]').first
                dest.click(button="right")
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
                check("tool" in page.get_by_role("dialog").inner_text().lower(),
                      "All Tools dialog rendered without searchable tools")

            def png_import_undo_redo():
                _, page, errors = app_page(browser)
                page.locator('input[type="file"]').first.set_input_files(
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
                ("png_import_layer_undo_redo", png_import_undo_redo),
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
