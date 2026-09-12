// Chay's Photo Studio — plugin popup logic (callback-style chrome.*
// APIs so the same file runs in Chrome and Firefox). The editor is
// bundled inside the extension, so opening it needs no configuration.
const $ = (id) => document.getElementById(id)

document.addEventListener('DOMContentLoaded', () => {
  $('open-editor').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
    window.close()
  })
})
