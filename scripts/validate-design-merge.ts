import assert from 'node:assert/strict'
import {
  parseDesignCsv, mergeText, mergeFieldNames, mergeEditableLayers,
  MAX_MERGE_ROWS, MAX_MERGE_CSV_BYTES,
} from '../src/editor/library/design-merge'

const csv = parseDesignCsv('\uFEFFName,Job,Message\r\nAlice,Designer,"Hello, ""world"""\r\nBob,Artist,"Line 1\nLine 2"\r\n')
assert.deepEqual(csv.columns, ['Name','Job','Message'])
assert.equal(csv.rows.length, 2)
assert.equal(csv.rows[0].Message, 'Hello, "world"')
assert.equal(csv.rows[1].Message, 'Line 1\nLine 2')
assert.deepEqual(mergeFieldNames(['Hello {{ Name }}, {{Job}}!', '{{ Name }}', 'not a token']),
  ['Name', 'Job'])
assert.equal(mergeText('Hi {{Name}} — {{Job}}: {{Missing}}', csv.rows[0]), 'Hi Alice — Designer: {{Missing}}')
assert.throws(() => parseDesignCsv(''), /empty/)
assert.throws(() => parseDesignCsv('A,B'), /at least one data row/)
assert.throws(() => parseDesignCsv('A,A\n1,2'), /duplicate/)
assert.throws(() => parseDesignCsv('A,B\n1'), /different number/)
assert.throws(() => parseDesignCsv('A\n"unterminated'), /unterminated/)
assert.throws(() => parseDesignCsv('A,B\n1,"a"whoops'), /Unexpected characters/)
assert.throws(() => parseDesignCsv('A\n'+'x'.repeat(2001)), /2,000 characters/)
assert.throws(() => parseDesignCsv('A\n' + 'x\n'.repeat(MAX_MERGE_ROWS + 1)), /Too many CSV rows/)
assert.throws(() => parseDesignCsv('A\n' + 'x'.repeat(MAX_MERGE_CSV_BYTES + 1)), /1 MiB/)
assert.throws(() => parseDesignCsv(Array.from({ length: 65 }, (_, i) => 'C'+i).join(',')+'\n'+Array(65).fill('x').join(',')), /Too many CSV columns/)

const layers = [
  {id:'b',kind:'raster',_v:1,text:null, canvas:{pixels:[]}},
  {id:'t',kind:'text',_v:12,text:{ content:'Welcome {{Name}}!',fontFamily:'Arial' }},
]
const result = mergeEditableLayers(layers,csv.rows[0])
assert.notEqual(result[1], layers[1])
assert.equal(result[0], layers[0], 'untouched layer is passed through for caller to clone for renderer')
assert.equal(result[1].text!.content, 'Welcome Alice!')
assert.equal(result[1]._v, 13)
assert.equal(result[1].text!.fontFamily, 'Arial')
assert.equal(layers[1].text!.content, 'Welcome {{Name}}!', 'source editable text cannot be changed by CSV data')
assert.equal(layers[1]._v, 12, 'source layer cache version remains untouched')
const untouched = mergeEditableLayers(layers,{ Name: 'Alice' })
assert.equal(untouched[0], layers[0])
assert.equal(mergeEditableLayers(layers, {Name:'Alice'})[1].text!.content,'Welcome Alice!')
assert.equal(mergeText('{{Name}}',{Name:'<script>alert(1)</script>'}),'<script>alert(1)</script>',
  'CSV values must be literal text, not executed or interpreted as HTML')
console.log('Validated CSV quotes, newlines, strict limits, placeholders, and source document non-mutation')
