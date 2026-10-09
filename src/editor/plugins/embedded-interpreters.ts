'use client'
import { evaluateScheme } from './embedded-scheme'

export type EmbeddedLanguage = 'scheme' | 'python'
export interface InterpreterResult { text: string; language: EmbeddedLanguage }

/**
 * No interpreter starts on import. Every click gets a disposable Web Worker;
 * cancellation, errors and timeout all terminate it and release its memory.
 * GIMP PDB/image editing is not emulated by these runtimes.
 */
const PINNED_PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
const MAX_SOURCE = 64000
const pythonWorker = [
  'self.onmessage = async (event) => {',
  '  try {',
  '    const { source, url } = event.data;',
  '    importScripts(url + "pyodide.js");',
  '    const runtime = await self.loadPyodide({ indexURL: url });',
  '    const deny = () => { throw new Error("Network access disabled inside embedded Python") };',
  '    for (const name of ["fetch","WebSocket","XMLHttpRequest","EventSource","importScripts"]) {',
  '      try { Object.defineProperty(self, name, { value: deny, configurable: false, writable: false }) } catch {}',
  '    }',
  '    let text = "";',
  '    runtime.setStdout({ batched: line => { if (text.length < 20000) text += line + "\\n" } });',
  '    runtime.setStderr({ batched: line => { if (text.length < 20000) text += line + "\\n" } });',
  '    const value = await runtime.runPythonAsync(source);',
  '    if (value !== undefined && value !== null && text.length < 20000) text += String(value);',
  '    if (value && typeof value.destroy === "function") value.destroy();',
  '    self.postMessage({ ok: true, text: text.slice(0, 20000) });',
  '  } catch (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); }',
  '};',
].join('\n')

/** Deterministic source builder, shared by the test suite. No worker starts here. */
export function getEmbeddedWorkerSource(language: EmbeddedLanguage): string {
  return language === 'scheme'
    ? 'self.onmessage = (event) => { try { const text = (' + evaluateScheme.toString() +
      ')(event.data.source); self.postMessage({ ok: true, text }); } catch (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); } };'
    : pythonWorker
}

export function runEmbeddedInterpreter(
  language: EmbeddedLanguage,
  source: string,
  options?: { allowDownload?: boolean; timeoutMs?: number },
): { result: Promise<InterpreterResult>; cancel(): void } {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable in this environment')
  if (!source.trim()) throw new Error('Enter source code to run')
  if (source.length > MAX_SOURCE) throw new Error('Embedded script exceeds the 64 KB limit')
  if (language === 'python' && !options?.allowDownload) {
    throw new Error('Embedded Python needs explicit permission to download Pyodide on first use')
  }
  const script = getEmbeddedWorkerSource(language)
  const blobUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }))
  let worker: Worker
  try { worker = new Worker(blobUrl) }
  finally { URL.revokeObjectURL(blobUrl) }
  let settled = false
  let rejectPromise: (error: Error) => void = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => { if (timeout) clearTimeout(timeout); worker.terminate() }
  const result = new Promise<InterpreterResult>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent<{ ok: boolean; text?: string; error?: string }>) => {
      if (settled) return
      settled = true; cleanup()
      if (event.data?.ok) resolve({ language, text: String(event.data.text || '') })
      else reject(new Error(event.data?.error || 'Interpreter failed'))
    }
    worker.onerror = () => {
      if (settled) return
      settled = true; cleanup()
      reject(new Error('Interpreter worker failed or was blocked by CSP'))
    }
    const max = language === 'python' ? 120000 : 4000
    timeout = setTimeout(() => {
      if (settled) return
      settled = true; cleanup()
      reject(new Error('Interpreter timed out and was stopped'))
    }, Math.min(max, Math.max(500, options?.timeoutMs ?? max)))
    worker.postMessage({ source, ...(language === 'python' ? { url: PINNED_PYODIDE } : {}) })
  })
  return {
    result,
    cancel: () => {
      if (settled) return
      settled = true; cleanup()
      rejectPromise(new Error('Interpreter cancelled'))
    },
  }
}
