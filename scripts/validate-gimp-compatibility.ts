import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { evaluateScheme } from '../src/editor/plugins/embedded-scheme'
import { getEmbeddedWorkerSource } from '../src/editor/plugins/embedded-interpreters'
import { analyzeGimpScript } from '../src/editor/plugins/gimp-script-analyzer'
import { analyzeGimpPluginSource } from '../src/editor/plugins/compatibility'

const scm = [
  '(script-fu-register "sample" "Sample" ...)',
  '(gimp-image-undo-group-start image)',
  '(gimp-drawable-brightness-contrast layer 0 0)',
  '(gegl:gaussian-blur node)',
  '(gimp-image-get-active-layer image)',
].join('\n')
const scheme = analyzeGimpScript(scm, 'filter.scm')
assert.equal(scheme.language, 'script-fu')
assert.equal(scheme.operations.find(op => op.name === 'gimp-drawable-brightness-contrast')?.status, 'native-editor')
assert.equal(scheme.operations.find(op => op.name === 'gegl:gaussian-blur')?.status, 'gegl-bridge')
assert.equal(scheme.operations.find(op => op.name === 'gimp-image-get-active-layer')?.status, 'requires-gimp')
assert.ok(scheme.warnings.some(w => w.includes('TinyScheme')))
const report = analyzeGimpPluginSource(scm, 'filter.scm')
assert.ok(report.unsupported.some(op => op.includes('get-active-layer')))
assert.ok(report.supported.some(op => op.includes('gaussian-blur')))

const py = analyzeGimpScript('from gi.repository import Gimp\nGimp.Image.get_by_id(1)\nGimp.get_pdb()', 'filter.py')
assert.equal(py.language, 'python')
assert.ok(py.operations.some(op => op.status === 'requires-gimp'))
assert.ok(py.warnings.some(w => w.includes('Python GI')))

const gmic = analyzeGimpScript('-blur 2\n-fx_sharpen 1\n-gegl:noise_reduction', 'effect.gmic')
assert.equal(gmic.language, 'gmic')
assert.equal(gmic.operations.find(op => op.name === 'fx_sharpen')?.status, 'gmic-bridge')
assert.equal(analyzeGimpScript('gegl:noise_reduction', 'effect.txt').operations[0]?.name, 'gegl:noise_reduction')
assert.equal(analyzeGimpScript('// no GIMP calls', 'empty.txt').operations.length, 0)
assert.throws(() => analyzeGimpScript('x'.repeat(2_000_001)), /limit/)
assert.deepEqual(analyzeGimpScript('throw new Error("EXECUTED")', 'unsafe.py').operations, [])
console.log('GIMP script analysis is static, bounded, and classifies native/bridge-only references')

assert.equal(evaluateScheme('(+ 2 (* 3 4))'), '14')
assert.equal(evaluateScheme('(define square (lambda (x) (* x x))) (square 9)'), '81')
assert.equal(evaluateScheme('(let ((x 7)) (if (> x 5) "big" "small"))'), 'big')
assert.match(evaluateScheme('(display "hello") (newline)'), /hello/)
assert.throws(() => evaluateScheme('(gimp-image-new 1 1)'), /GIMP PDB is unavailable/)
assert.throws(() => evaluateScheme('('.repeat(500)), /complexity|Missing|Unexpected/)
assert.throws(() => evaluateScheme('x'.repeat(64001)), /64 KB/)
new Script(getEmbeddedWorkerSource('scheme'))
new Script(getEmbeddedWorkerSource('python'))
console.log('Embedded workers parse and Scheme executes without GIMP or external interpreter load')
