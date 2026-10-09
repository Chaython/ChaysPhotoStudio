'use strict'
// Optional GIMP 3 PDB host. Importing registers NO processes or probes.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const MAX_IMAGE = 128 * 1024 * 1024
const PROC_NAME = /^[a-z][a-z0-9-]{1,120}$/
const PARAM_NAME = /^[a-z][a-z0-9-]{0,80}$/
function candidates() {
  const options = [process.env.CHAYS_GIMP_PATH, 'gimp-3.0', 'gimp-3', 'gimp']
  if (process.platform === 'win32') {
    options.push('gimp-3.0.exe')
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      options.push(path.join(root, 'GIMP 3', 'bin', 'gimp-3.0.exe'))
      options.push(path.join(root, 'GIMP 3', 'bin', 'gimp.exe'))
    }
  }
  return [...new Set(options.filter(Boolean))]
}
function launch(exe, args, timeout = 180000) {
  return new Promise((resolve, reject) => execFile(exe, args, {
    windowsHide: true, timeout, maxBuffer: 512 * 1024
  }, (error, stdout, stderr) => {
    if (error) { error.stderr = String(stderr || '').slice(-3000); reject(error); return }
    resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
  }))
}
async function detectGimp() {
  for (const executable of candidates()) {
    try {
      const output = await launch(executable, ['--version'], 8000)
      const version = (output.stdout + output.stderr).trim().split(/\r?\n/)[0]
      if (/\b3\.\d+/.test(version)) return { available: true, executable, version }
    } catch { /* Next candidate. This only runs when the user opens the runtime. */ }
  }
  return { available: false, executable: '', version: '' }
}
function decodePng(image) {
  const m = typeof image === 'string' && image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!m || m[1].length > MAX_IMAGE * 1.4) throw new Error('GIMP requires a bounded PNG data URL')
  const data = Buffer.from(m[1], 'base64')
  if (data.length < 8 || data.length > MAX_IMAGE || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG input')
  return data
}
function literal(value) { return JSON.stringify(value) }
const HEADER = [
  'import json, traceback, gi',
  'gi.require_version("Gimp", "3.0")',
  'gi.require_version("Gio", "2.0")',
  'from gi.repository import Gimp, Gio',
  'def _save(value):',
  '    with open(RESULT_PATH, "w", encoding="utf-8") as stream:',
  '        json.dump(value, stream)',
].join('\n')
async function inTemp(action) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chays-gimp-'))
  try { return await action(dir) }
  finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}) }
}
async function batch(executable, dir, python, timeout = 180000) {
  const script = path.join(dir, 'bridge.py')
  const resultFile = path.join(dir, 'result.json')
  const body = 'RESULT_PATH = ' + literal(resultFile) + '\n' + HEADER + '\ntry:\n' +
    python.split('\n').map(line => '    ' + line).join('\n') +
    '\nexcept Exception:\n    _save({"ok": False, "error": traceback.format_exc()[-3000:]})\n'
  await fs.promises.writeFile(script, body, { mode: 0o600 })
  const command = 'exec(compile(open(' + literal(script) + ', encoding="utf-8").read(), ' + literal(script) + ', "exec"))'
  let error
  try {
    await launch(executable, ['--no-interface', '--new-instance', '--quit', '--batch-interpreter=python-fu-eval', '--batch=' + command], timeout)
  } catch (e) { error = e }
  let report
  try {
    const raw = await fs.promises.readFile(resultFile, 'utf8')
    if (raw.length > 1024 * 1024) throw new Error('GIMP result too large')
    report = JSON.parse(raw)
  } catch { throw new Error('GIMP did not return a batch result: ' + String(error?.stderr || error?.message || 'unknown error').slice(-1000)) }
  if (report?.ok !== true) throw new Error(String(report?.error || error?.message || 'GIMP execution failed').slice(-3000))
  return report
}
const discovery = [
  'pdb = Gimp.get_pdb()',
  'names = pdb.query_procedures(".*", ".*", ".*", ".*", ".*", ".*", ".*", "GIMP Plug-in")',
  'names = sorted(str(name) for name in (names or []))',
  '_save({"ok": True, "procedures": names[:1200], "total": len(names)})',
].join('\n')
function inspectScript(name) {
  return [
    'proc = Gimp.get_pdb().lookup_procedure(' + literal(name) + ')',
    'if proc is None: raise RuntimeError("GIMP procedure unavailable")',
    'props = proc.create_config().list_properties()',
    '_save({"ok": True, "arguments": [{"name": p.name, "type": p.value_type.name} for p in props[:100]]})',
  ].join('\n')
}
function executeScript(name, input, output, values) {
  return [
    'image = Gimp.file_load(Gimp.RunMode.NONINTERACTIVE, Gio.File.new_for_path(' + literal(input) + '))',
    'if image is None: raise RuntimeError("Cannot open PNG in GIMP")',
    'proc = Gimp.get_pdb().lookup_procedure(' + literal(name) + ')',
    'if proc is None: raise RuntimeError("GIMP procedure unavailable")',
    'config = proc.create_config()',
    'properties = {p.name: p for p in config.list_properties()}',
    'params = json.loads(' + literal(JSON.stringify(values)) + ')',
    'if "run-mode" in properties: config.set_property("run-mode", Gimp.RunMode.NONINTERACTIVE)',
    'if "image" in properties: config.set_property("image", image)',
    'if "drawable" in properties:',
    '    layers = image.get_selected_drawables()',
    '    if not layers: raise RuntimeError("No selected GIMP drawable")',
    '    config.set_property("drawable", layers[0])',
    'for key, value in params.items():',
    '    if key in ("run-mode", "image", "drawable", "drawables", "file"): raise ValueError("Protected parameter " + key)',
    '    if key not in properties: raise ValueError("Unknown parameter " + key)',
    '    config.set_property(key, value)',
    'result = proc.run(config)',
    'if result.index(0) != Gimp.PDBStatusType.SUCCESS: raise RuntimeError("GIMP procedure failed: " + str(result.index(0)))',
    'if not Gimp.file_save(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(' + literal(output) + '), None): raise RuntimeError("Cannot export PNG")',
    '_save({"ok": True})'
  ].join('\n')
}
async function withGimp(mode, payload = {}) {
  const detected = await detectGimp()
  if (!detected.available) throw new Error('GIMP 3 not found; install GIMP or configure CHAYS_GIMP_PATH.')
  const name = String(payload.name || '')
  if (mode !== 'list' && mode !== 'script' && !PROC_NAME.test(name)) throw new Error('Invalid GIMP procedure name')
  return inTemp(async dir => {
    if (mode === 'list') return batch(detected.executable, dir, discovery, 90000)
    if (mode === 'inspect') return batch(detected.executable, dir, inspectScript(name), 90000)
    if (mode === 'script') {
      const language = payload.language
      const source = payload.source
      if (!['python', 'scheme'].includes(language) || typeof source !== 'string' ||
          !source.trim() || source.length > 128000 || source.includes('\0')) {
        throw new Error('Unsupported or oversized GIMP script')
      }
      const input = path.join(dir, 'input.png'), output = path.join(dir, 'output.png')
      const script = path.join(dir, language === 'python' ? 'user.py' : 'user.scm')
      await fs.promises.writeFile(input, decodePng(payload.image), { mode: 0o600 })
      await fs.promises.writeFile(script, source, { mode: 0o600 })
      const steps = [
        'image = Gimp.file_load(Gimp.RunMode.NONINTERACTIVE, Gio.File.new_for_path(' + literal(input) + '))',
        'if image is None: raise RuntimeError("Cannot open input PNG")',
        'drawables = image.get_selected_drawables()',
        'drawable = drawables[0] if drawables else None',
      ]
      if (language === 'python') {
        steps.push('with open(' + literal(script) + ', encoding="utf-8") as stream: code = stream.read()')
        steps.push('exec(compile(code, ' + literal(script) + ', "exec"), globals())')
      } else {
        // Full GIMP Script-Fu interpreter, not the browser Scheme subset.
        // GIMP procedure handles native GIMP 3 script parsing and evaluation.
        const expression = '(load ' + literal(script) + ')'
        steps.push('proc = Gimp.get_pdb().lookup_procedure("plug-in-script-fu-eval")')
        steps.push('if proc is None: raise RuntimeError("Script-Fu evaluation plugin unavailable")')
        steps.push('config = proc.create_config()')
        steps.push('config.set_property("script", ' + literal(expression) + ')')
        steps.push('result = proc.run(config)')
        steps.push('if result.index(0) != Gimp.PDBStatusType.SUCCESS: raise RuntimeError("Script-Fu execution failed")')
      }
      steps.push('if not Gimp.file_save(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(' + literal(output) + '), None): raise RuntimeError("Cannot export result PNG")')
      steps.push('_save({"ok": True})')
      await batch(detected.executable, dir, steps.join('\n'))
      const png = await fs.promises.readFile(output)
      if (png.length < 8 || png.length > MAX_IMAGE || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('GIMP returned invalid PNG')
      return { image: 'data:image/png;base64,' + png.toString('base64') }
    }
    if (mode !== 'run') throw new Error('Unknown GIMP mode')
    const values = payload.parameters || {}
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 32) throw new Error('Invalid GIMP arguments')
    for (const [key, value] of Object.entries(values)) {
      if (!PARAM_NAME.test(key) || !['boolean', 'number', 'string'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value)) ||
          (typeof value === 'string' && value.length > 2000)) throw new Error('Unsupported GIMP parameter: ' + key)
    }
    const input = path.join(dir, 'input.png'), output = path.join(dir, 'output.png')
    await fs.promises.writeFile(input, decodePng(payload.image), { mode: 0o600 })
    await batch(detected.executable, dir, executeScript(name, input, output, values))
    const png = await fs.promises.readFile(output)
    if (png.length < 8 || png.length > MAX_IMAGE || png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('GIMP did not return valid PNG pixels')
    return { image: 'data:image/png;base64,' + png.toString('base64') }
  })
}
function installGimpIpc(ipcMain) {
  // Handler registration has no side effects; each handler performs requested work.
  ipcMain.handle('chays:gimp:info', () => detectGimp())
  ipcMain.handle('chays:gimp:list', () => withGimp('list'))
  ipcMain.handle('chays:gimp:inspect', (_event, name) => withGimp('inspect', { name }))
  ipcMain.handle('chays:gimp:run', (_event, payload) => withGimp('run', payload))
  ipcMain.handle('chays:gimp:script', (_event, payload) => withGimp('script', payload))
}
module.exports = { detectGimp, installGimpIpc }
