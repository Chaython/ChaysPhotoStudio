import { writeFileSync } from 'node:fs'
import { renderUserGuideMarkdown } from '../src/editor/help/guide-markdown'
writeFileSync(new URL('../docs/USER_GUIDE.md',import.meta.url),renderUserGuideMarkdown(),'utf8')
console.log('Updated docs/USER_GUIDE.md')
