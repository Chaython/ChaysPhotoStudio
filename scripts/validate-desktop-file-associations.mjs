import fs from 'node:fs'
import assert from 'node:assert/strict'
const root = new URL('../', import.meta.url)
const read = path => fs.readFileSync(new URL(path, root), 'utf8')
const tauri = JSON.parse(read('webview/src-tauri/tauri.conf.json'))
const groups = tauri.bundle.fileAssociations
const registered = new Set(groups.flatMap(group => Array.isArray(group.ext) ? group.ext : [group.ext]))
const source = read('src/editor/formats/photopea-formats.ts')
const names = ['PHOTOPEA_COMPLEX_EXTENSIONS','PHOTOPEA_RASTER_EXTENSIONS','PHOTOPEA_RAW_EXTENSIONS','PHOTOPEA_ANIMATED_EXTENSIONS','EXTRA_IMPORT_EXTENSIONS']
for (const name of names) {
  const match = source.match(new RegExp('export const ' + name + ' = \\[([\\s\\S]*?)\\] as const'))
  assert.ok(match, 'missing import extension group ' + name)
  for (const [, ext] of match[1].matchAll(/'([^']+)'/g))
    assert.ok(registered.has(ext), 'Tauri missing import association: .' + ext)
}
const electron = read('electron-builder.yml')
const assoc = electron.slice(electron.indexOf('fileAssociations:'), electron.indexOf('compression: normal'))
for (const ext of registered)
  assert.ok(new RegExp('(?:\\[|,\\s)' + ext + '(?:,|\\s|\\])').test(assoc),
    'Electron missing association: .' + ext)
assert.ok(tauri.app.withGlobalTauri === true, 'Tauri invoke not exposed')
const shell = read('webview/src-tauri/src/lib.rs')
assert.ok(shell.includes('take_associated_files'), 'Tauri file-open handler missing')
assert.ok(shell.includes('RunEvent::Opened'), 'macOS open-file handler missing')
assert.ok(shell.includes('tauri_plugin_single_instance'), 'second-instance forwarding missing')
console.log('Desktop file-association configuration: OK')
