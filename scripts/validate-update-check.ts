import assert from 'node:assert/strict'
import { checkForReleases, compareCoreVersions, currentVersion } from '../src/editor/update-check'

assert.match(currentVersion, /^\d+\.\d+\.\d+$/)
assert.equal(compareCoreVersions('v1.4.0-b100', '1.3.9'), 1)
assert.equal(compareCoreVersions('v1.3.0-b99', '1.3.0'), 0)
assert.equal(compareCoreVersions('1.2.9', '1.3.0'), -1)
assert.equal(compareCoreVersions('invalid', '1.3.0'), null)

let calls = 0
const fakeFetch = (async (url: string) => {
  calls++
  assert.match(url, /^https:\/\/api\.github\.com\/repos\/Chaython\/ChaysPhotoStudio\/releases\?per_page=/)
  return new Response(JSON.stringify([
    { draft: true, tag_name: 'v99.0.0' },
    { draft: false, tag_name: 'v1.4.0-b22', name: 'Continuous Build', body: 'Changes', published_at: '2026-10-01T00:00:00Z' },
  ]), { status: 200 })
}) as unknown as typeof fetch
assert.equal(calls, 0, 'no startup network request should occur')
const info = await checkForReleases(fakeFetch)
assert.equal(calls, 1)
assert.equal(info.tag, 'v1.4.0-b22')
assert.equal(info.newerVersion, true)
assert.equal(info.notes, 'Changes')
assert.match(info.url, /^https:\/\/github\.com\/Chaython\/ChaysPhotoStudio\/releases\/tag\//)

const failedFetch = (async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch
await assert.rejects(() => checkForReleases(failedFetch), /HTTP 503/)
console.log('Manual release checker handles version families and offline/API failures without auto-install')
