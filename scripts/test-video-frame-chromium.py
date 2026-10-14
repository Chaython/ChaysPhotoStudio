#!/usr/bin/env python3
"""Real Chromium smoke test for the standalone interactive picker (not a mocked DOM).

The fixture is the deterministic two-tone WebM embedded in the full editor E2E
suite. Compiled picker script is injected without building the entire Next app,
so seeking and canvas capture are verified on every relevant commit.
"""
import base64
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright
from video_fixture import video_fixture

def main() -> None:
    executable = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
    if not executable:
        raise RuntimeError("Chrome/Chromium is required for real video decoding tests")
    js_path = Path("build/video-frame-picker-standalone.js")
    assert js_path.is_file(), "Compile picker source to standalone JavaScript before test"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable, headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page(viewport={"width": 1000, "height": 800})
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("about:blank")
            page.add_script_tag(path=str(js_path))
            fixture = base64.b64encode(video_fixture()).decode('ascii')
            page.evaluate("""fixture => {
              window.__videoInput = new File(
                [Uint8Array.from(atob(fixture), c => c.charCodeAt(0))],
                'two-tone.webm', { type: 'video/webm' }
              )
              window.__videoOutcome = null
              window.__pickVideoFrame(window.__videoInput).then(canvas => {
                window.__videoOutcome = {
                  ok: true, w: canvas.width, h: canvas.height,
                  color: [...canvas.getContext('2d').getImageData(40, 30, 1, 1).data],
                }
              }, error => {
                window.__videoOutcome = { ok: false, error: error.name }
              })
            }""", fixture)
            dialog = page.get_by_role("dialog", name="Import frame from video")
            dialog.wait_for(state="visible", timeout=15000)
            page.wait_for_function("""() => {
              const video = document.querySelector('[data-video-preview]')
              return !!video && video.videoWidth === 80 && video.videoHeight === 60 &&
                video.readyState >= 2
            }""", timeout=15000)
            picker = dialog.locator("input[data-video-time]")
            picker.fill("1.5")
            picker.press("Tab")
            page.wait_for_function("""() => {
              const video = document.querySelector('[data-video-preview]')
              const button = document.querySelector('[data-video-import]')
              return !!video && Math.abs(video.currentTime - 1.5) < .1 &&
                !video.seeking && !!button && !button.disabled
            }""", timeout=15000)
            current = dialog.locator("video").evaluate("""video => {
              const c = document.createElement('canvas')
              c.width = 80; c.height = 60
              c.getContext('2d').drawImage(video, 0, 0)
              return [...c.getContext('2d').getImageData(40, 30, 1, 1).data]
            }""")
            assert current[2] > 140 and current[0] < 100, f"Selected preview is not blue: {current}"
            dialog.locator("[data-video-import]").click()
            page.wait_for_function("() => window.__videoOutcome !== null", timeout=10000)
            result = page.evaluate("() => window.__videoOutcome")
            assert result["ok"] and (result["w"], result["h"]) == (80, 60), result
            assert result["color"][2] > 140 and result["color"][0] < 100, result

            # Cancellation must close cleanly and release the video, not create a frame.
            page.evaluate("""() => {
              window.__videoOutcome = null
              window.__pickVideoFrame(window.__videoInput).then(
                () => { window.__videoOutcome = { ok: true } },
                err => { window.__videoOutcome = { ok: false, error: err.name } }
              )
            }""")
            dialog.wait_for(state="visible", timeout=10000)
            dialog.locator("[data-video-cancel]").click()
            page.wait_for_function("() => window.__videoOutcome !== null", timeout=10000)
            assert page.evaluate("() => window.__videoOutcome") == {"ok": False, "error": "AbortError"}
            assert not errors, f"Uncaught Chromium errors: {errors}"
            print("PASS real Chromium video picker: VP8 decode, seek 1.5s, blue-frame import, cancellation")
        finally:
            browser.close()

if __name__ == "__main__":
    main()
