import { version as currentVersion } from '../../package.json'

export { currentVersion }

export interface ReleaseCheck {
  tag: string
  name: string
  notes: string
  publishedAt: string
  url: string
  /** Only a higher semantic app version is unambiguously newer. */
  newerVersion: boolean
  /** Continuous build tags share the same base app version. */
  sameVersionFamily: boolean
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string | null
  published_at?: string | null
  draft?: boolean
}

function coreVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:$|[+-])/.exec(version.trim())
  return match ? match.slice(1, 4).map(Number) : null
}

export function compareCoreVersions(a: string, b: string): number | null {
  const av = coreVersion(a), bv = coreVersion(b)
  if (!av || !bv) return null
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return Math.sign(av[i] - bv[i])
  return 0
}

/** Explicit user gesture only: no automatic startup checks or installers. */
export async function checkForReleases(fetcher: typeof fetch = fetch): Promise<ReleaseCheck> {
  const response = await fetcher('https://api.github.com/repos/Chaython/ChaysPhotoStudio/releases?per_page=10', {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Could not check releases (HTTP ${response.status}). Check internet connectivity.`)
  const releases = await response.json() as GitHubRelease[]
  if (!Array.isArray(releases)) throw new Error('Unexpected GitHub Releases response')
  const latest = releases.find(r => !r.draft && r.tag_name)
  if (!latest?.tag_name) throw new Error('No published release is available yet')
  const comparison = compareCoreVersions(latest.tag_name, currentVersion)
  return {
    tag: latest.tag_name,
    name: latest.name || latest.tag_name,
    notes: String(latest.body || '').slice(0, 700),
    publishedAt: latest.published_at || '',
    url: `https://github.com/Chaython/ChaysPhotoStudio/releases/tag/${encodeURIComponent(latest.tag_name)}`,
    newerVersion: comparison !== null && comparison > 0,
    sameVersionFamily: comparison === 0,
  }
}
