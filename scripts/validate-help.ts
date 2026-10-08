import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HELP_TOPICS, HELP_CATEGORIES, getHelpTopic, searchHelpTopics } from '../src/editor/help/topics'
import { renderUserGuideMarkdown } from '../src/editor/help/guide-markdown'
assert.ok(HELP_TOPICS.length >= 15)
const ids = new Set<string>()
for (const t of HELP_TOPICS) {
  assert.match(t.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(!ids.has(t.id), `Duplicate help topic ${t.id}`)
  assert.ok(HELP_CATEGORIES.includes(t.category))
  assert.ok(t.path && t.summary && t.steps.length)
  assert.equal(getHelpTopic(t.id), t)
  ids.add(t.id)
}
for (const id of ['getting-started','grow-similar','stroke-selection','offset','troubleshooting']) {
  assert.ok(getHelpTopic(id), `Missing key help topic ${id}`)
}
assert.equal(getHelpTopic('unknown'), undefined)
assert.ok(searchHelpTopics('STROKE selection').some(t=>t.id === 'stroke-selection'),
  'search finds Stroke Selection even when other relevant results also match')
assert.ok(searchHelpTopics('wrap around', 'Filters').some(t=>t.id === 'offset'))
assert.equal(searchHelpTopics('offset', 'Selections').length, 0)
assert.equal(readFileSync(new URL('../docs/USER_GUIDE.md',import.meta.url),'utf8'),renderUserGuideMarkdown(),
  'User guide is out of date; run bun run help:generate')
console.log(`Validated ${HELP_TOPICS.length} Help topics, searching and generated Markdown`)
