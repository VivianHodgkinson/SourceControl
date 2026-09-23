import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Updates come from published GitHub Releases (drafts are ignored).
 *
 * - "auto": the Windows installer build and the AppImage download updates in the
 *   background with electron-updater and install on restart (or on quit).
 * - "notify": builds that can't replace themselves — the portable exe, and the
 *   deb/rpm/pacman/tar.gz packages that belong to the system package manager —
 *   check the latest release and link to it.
 * - "disabled": development builds.
 */

const REPO = 'VivianHodgkinson/SourceControl'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus
let emit: (s: UpdateStatus) => void = () => {}

function detectMode(): UpdateStatus['mode'] {
  if (!app.isPackaged) return 'disabled'
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR ? 'notify' : 'auto'
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'auto' : 'notify'
  return 'notify'
}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  emit(status)
}

/** No published release yet looks like an error to electron-updater; it just means we're current. */
function isNoRelease(message: string): boolean {
  return /404|Unable to find latest version|No published versions|Cannot find latest/i.test(message)
}

export function initUpdater(onStatus: (s: UpdateStatus) => void, enabled: () => boolean): void {
  emit = onStatus
  status = { currentVersion: app.getVersion(), mode: detectMode(), state: 'idle' }
  if (status.mode === 'disabled') return

  if (status.mode === 'auto') {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, progress: 0 }))
    autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', lastChecked: Date.now() }))
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, lastChecked: Date.now() }))
    autoUpdater.on('error', (e) => {
      if (isNoRelease(e.message)) set({ state: 'up-to-date', lastChecked: Date.now() })
      else set({ state: 'error', error: e.message.split('\n')[0] })
    })
  }

  setTimeout(() => enabled() && checkForUpdates(), 15_000)
  setInterval(() => enabled() && checkForUpdates(), CHECK_EVERY_MS)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.mode === 'disabled' || ['checking', 'downloading', 'ready'].includes(status.state)) return status

  if (status.mode === 'auto') {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      const message = (e as Error).message
      if (isNoRelease(message)) set({ state: 'up-to-date', lastChecked: Date.now() })
      else set({ state: 'error', error: message.split('\n')[0] })
    }
    return status
  }

  set({ state: 'checking', error: undefined })
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SourceControl-Git-Client' }
    })
    if (res.status === 404) {
      set({ state: 'up-to-date', lastChecked: Date.now() })
      return status
    }
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const release = (await res.json()) as { tag_name: string; html_url: string }
    const latest = release.tag_name.replace(/^v/, '')
    if (isNewer(latest, status.currentVersion)) set({ state: 'available', version: latest, releaseUrl: release.html_url, lastChecked: Date.now() })
    else set({ state: 'up-to-date', lastChecked: Date.now() })
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
  }
  return status
}

/** Restart into a downloaded update, or open the release page for builds that can't self-update. */
export function installUpdate(): void {
  if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true))
  else if (status.releaseUrl) shell.openExternal(status.releaseUrl)
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
