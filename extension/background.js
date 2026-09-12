// Chay's Photo Studio — browser plugin background.
// The plugin is self-contained: the full editor webapp is bundled
// inside the extension (index.html + _next assets at the package
// root), so it opens instantly with no server and works offline.
// Chrome MV3: service worker. Firefox MV3 (build variant): event
// page (the build script swaps the manifest's background key; this
// file is written in callback style so it runs unchanged in both).
const EDITOR_PAGE = 'index.html'

function editorUrl(params) {
  const base = chrome.runtime.getURL(EDITOR_PAGE)
  if (!params) return base
  return base + '?' + new URLSearchParams(params).toString()
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
  if (info.menuItemId === 'chays-edit-image' && info.srcUrl) {
    chrome.tabs.create({ url: editorUrl({ url: info.srcUrl }) })
  } else if (info.menuItemId === 'chays-open-editor') {
    chrome.tabs.create({ url: editorUrl() })
  }
})
