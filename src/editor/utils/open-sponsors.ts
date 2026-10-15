/** Open the fixed GitHub Sponsors page outside native desktop shells. */
export function openSponsorsPage(): void {
  const url = 'https://github.com/sponsors/Chaython'
  const invoke = (window as unknown as {
    __TAURI__?: { core?: { invoke?: (command: string) => Promise<void> } }
  }).__TAURI__?.core?.invoke
  if (typeof invoke === 'function') {
    void invoke('open_sponsors_page').catch(error => {
      console.error('Unable to open GitHub Sponsors in system browser', error)
    })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
