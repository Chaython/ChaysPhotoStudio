import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatSamplerCsv } from '../src/editor/tools/sampler-report'

const transparent = formatSamplerCsv([{ x: 2, y: 3, hex: null }], 'composite', 1)
const transparentLines = transparent.split('\r\n')
assert.equal(transparentLines.length, 2)
assert.ok(transparentLines[1].includes('"Transparent"'))
assert.ok(!transparentLines[1].includes('"#000000"'))
assert.equal(transparentLines[1].split(',').length, 19, 'Transparent samples retain all CSV columns')

const sample = formatSamplerCsv([{ x: 5.3, y: 5, hex: '#12ab34' }], 'layer', 5)
assert.ok(sample.includes('"5.30","5.00","Current Layer","5","#12AB34"'))
assert.equal(sample.split('\r\n')[1].split(',').length, 19)
const multi = formatSamplerCsv([
  { x: 0, y: 0, hex: null },
  { x: 9, y: 10, hex: '#000000' },
], 'composite', 3)
assert.equal(multi.split('\r\n').length, 3)
assert.ok(multi.includes('"Transparent"'))
assert.ok(multi.includes('"#000000"'), 'Actual opaque black stays distinguishable')

const code = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const panel = code('src/editor/components/panels/info-panel.tsx')
const engine = code('src/editor/engine/engine.ts')
assert.match(panel, /hex === null \? null : readColor\(hex\)/, 'No false black fallback')
assert.match(panel, /formatSamplerCsv\(/, 'The CSV export must use the tested converter')
assert.match(panel, /Sampler \$\{index \+ 1\} \$\{axis\.toUpperCase\(\)\} coordinate/)
assert.match(engine, /if \(!doc \|\| !p \|\| !Number\.isFinite\(x\) \|\| !Number\.isFinite\(y\)\) return/)
assert.match(engine, /if \(nextX === p\.x && nextY === p\.y\) return/)
console.log('Color sampler CSV, transparent samples, coordinate controls and invalid-move guards validated.')
