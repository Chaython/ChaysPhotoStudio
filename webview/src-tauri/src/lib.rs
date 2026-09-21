//! Disposable runtime diagnostics for the packaged WebView.
//! This file lives only on the diagnostic branch/PR and must not be merged.
use std::{thread, time::Duration};
use tauri::webview::PageLoadEvent;

const DIAG_INIT: &str = r#"
window.__CHAYS_DIAG = { errors: [], startedAt: Date.now() };
function __chaysDiagError(kind, value) {
  try {
    window.__CHAYS_DIAG.errors.push({ kind, value: String(value ?? ''), at: Date.now() });
  } catch (_) {}
}
window.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t !== window) {
    __chaysDiagError('resource-error', (t.tagName || '?') + ' ' + (t.src || t.href || ''));
  } else {
    __chaysDiagError('window-error', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  }
}, true);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  __chaysDiagError('unhandledrejection', r && (r.stack || r.message) ? (r.stack || r.message) : String(r));
});
"#;

fn run_diagnostic(webview: tauri::Webview) {
    let js = r#"
(() => {
  const safeRules = (s) => { try { return s.cssRules ? s.cssRules.length : null } catch (e) { return 'ERR:' + e } };
  const resources = performance.getEntriesByType('resource').map(r => ({
    name: r.name,
    type: r.initiatorType,
    duration: Math.round(r.duration),
    transferSize: r.transferSize || 0
  }));
  const styles = Array.from(document.styleSheets).map(s => ({ href: s.href, rules: safeRules(s) }));
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(x => x.href);
  const scripts = Array.from(document.scripts).map(x => ({ src: x.src, type: x.type, async: x.async }));
  const first = document.body && document.body.firstElementChild;
  const firstStyle = first ? getComputedStyle(first) : null;
  return JSON.stringify({
    href: location.href,
    origin: location.origin,
    protocol: location.protocol,
    readyState: document.readyState,
    title: document.title,
    bodyText: document.body ? document.body.innerText.slice(0, 1000) : null,
    bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null,
    firstTag: first ? first.tagName : null,
    firstDisplay: firstStyle ? firstStyle.display : null,
    firstPosition: firstStyle ? firstStyle.position : null,
    firstWidth: firstStyle ? firstStyle.width : null,
    firstHeight: firstStyle ? firstStyle.height : null,
    editorEngine: Boolean(window.__zphotoEngine),
    editorStore: Boolean(window.__zphotoStore),
    nextFlight: Boolean(window.next && window.next.version) || Array.isArray(window.__next_f),
    diag: window.__CHAYS_DIAG || null,
    links,
    styles,
    scripts,
    resources
  });
})()
"#;
    if let Err(err) = webview.eval_with_callback(js, |result| {
        println!("[CHAYS_DIAG_RESULT] {result}");
    }) {
        eprintln!("[CHAYS_DIAG_EVAL_ERROR] {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let diag_plugin = tauri::plugin::Builder::new("runtime-diagnostic")
        .js_init_script(DIAG_INIT)
        .build();

    tauri::Builder::default()
        .plugin(diag_plugin)
        .on_page_load(|webview, payload| {
            println!("[CHAYS_PAGE_LOAD] {:?} {}", payload.event(), payload.url());
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let view = webview.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(8));
                    run_diagnostic(view);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
