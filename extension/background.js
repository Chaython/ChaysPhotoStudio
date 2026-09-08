// Chay's Photo Studio — browser plugin background.
// Chrome MV3: service worker. Firefox MV3 (build variant): event page
// (the build script swaps the manifest's background key; this file is
// written in callback style so it runs unchanged in both).
// `__EDITOR_URL__` is replaced at build time (scripts/build-extension.mjs).
const DEFAULT_EDITOR_URL = '__EDITOR_URL__'

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(keys, (res) => resolve(res || {}))
    } catch (e) {
      resolve({})
    }
  })
}

function openEditor(callback) {
  storageGet('editorUrl').then((res) => {
    const base = String((res && res.editorUrl) || DEFAULT_EDITOR_URL).replace(/\/+$/, '')
    callback(base)
  })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'chays-open-editor',
      title: "Open Chay's Photo Studio",
      contexts: ['action'],
    })
    chrome.contextMenus.create({
      id: 'chays-edit-image',
      title: "Edit image in Chay's Photo Studio",
      contexts: ['image'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  openEditor((base) => {
    if (info.menuItemId === 'chays-edit-image' && info.srcUrl) {
      chrome.tabs.create({ url: base + '/?url=' + encodeURIComponent(info.srcUrl) })
    } else if (info.menuItemId === 'chays-open-editor') {
      chrome.tabs.create({ url: base + '/' })
    }
  })
})
