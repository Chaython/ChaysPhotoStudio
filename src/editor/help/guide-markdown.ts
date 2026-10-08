import { HELP_CATEGORIES, HELP_TOPICS } from './topics'
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
export function renderUserGuideMarkdown(): string {
  const lines = [
    "# Chay's Photo Studio — User Guide", "",
    "This manual mirrors the in-app **Help** dialog. Click the Help button in the editor toolbar or choose **Help → User Guide & Documentation…**. In-app topics are bundled for offline use.", "",
    "For technical parity details, see [TOOL_PARITY.md](../TOOL_PARITY.md). For development, see [README.md](../README.md).", "",
    "## Contents", "",
  ]
  for (const category of HELP_CATEGORIES) {
    const items = HELP_TOPICS.filter(t => t.category === category)
    if (!items.length) continue
    lines.push(`### ${category}`, '')
    for (const t of items) lines.push(`- [${t.title}](#${slug(t.title)})`)
    lines.push('')
  }
  for (const t of HELP_TOPICS) {
    lines.push(`## ${t.title}`, '', t.summary, '', `**Where:** ${t.path}`, '')
    t.steps.forEach((step,i) => lines.push(`${i+1}. ${step}`))
    if(t.tips.length) {
      lines.push('', '**Notes and tips:**', '')
      t.tips.forEach(tip => lines.push(`- ${tip}`))
    }
    lines.push('')
  }
  return lines.join('\n')
}
