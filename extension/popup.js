// Chay's Photo Studio — plugin popup logic (callback-style chrome.*
// APIs so the same file runs in Chrome and Firefox).
// `__EDITOR_URL__` is replaced at build time (scripts/build-extension.mjs).
const DEFAULT_EDITOR_URL = '__EDITOR_URL__'

const $ = (id) => document.getElementById(id)

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(keys, (res) => resolve(res || {}))
    } catch (e) {
      resolve({})
    }
  })
}

function storageSet(obj, cb) {
  try {
    chrome.storage.sync.set(obj, cb)
  } catch (e) {
    if (cb) cb()
  }
}

function normalize(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    return /^https?:$/.test(u.protocol) ? trimmed : null
  } catch (e) {
    return null
  }
}

document.addEventListener('DOMContentLoaded', () => {
  storageGet('editorUrl').then((res) => {
    const saved = normalize(res && res.editorUrl)
    $('editor-url').value = saved || DEFAULT_EDITOR_URL
  })

  $('open-editor').addEventListener('click', () => {
    const base = normalize($('editor-url').value) || DEFAULT_EDITOR_URL
    chrome.tabs.create({ url: base + '/' })
    window.close()
  })

  $('save-url').addEventListener('click', () => {
    const status = $('status')
    const base = normalize($('editor-url').value)
    if (!base) {
      status.textContent = 'Enter a valid http(s) URL.'
      status.className = 'status err'
      return
    }
    storageSet({ editorUrl: base }, () => {
      status.textContent = 'Saved — the right-click menu will use it.'
      status.className = 'status ok'
    })
  })

  $('editor-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('save-url').click()
  })
})
