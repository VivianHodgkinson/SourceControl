import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateStatus } from '@shared/types'
import { assetName, installCommand, type InstallKind } from './updateAsset'

/**
 * Updates come from published GitHub Releases (drafts are ignored).
 *
 * - "auto": the Windows installer build and the AppImage download updates in the
 *   background with electron-updater and install on restart (or on quit).
 * - "notify": builds that can't replace themselves — the portable exe, and the
 *   deb/rpm/pacman/tar.gz packages that belong to the system package manager —
 *   download the matching file for this install type and CPU to Downloads, then
 *   open it or show the install command. Falls back to the release page.
 * - "disabled": development builds.
 *
 * The notify path uses github.com download URLs, not the REST API, which is
 * limited to 60 requests an hour per IP and shared by everyone behind that IP.
 */

const REPO = 'VivianHodgkinson/SourceControl'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus
let emit: (s: UpdateStatus) => void = () => {}
let assetUrl: string | null = null
let installKind: InstallKind | null = null

/** How this copy was installed, for picking the right download. */
function detectInstallKind(): InstallKind | null {
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : null
  if (process.platform !== 'linux' || process.env.APPIMAGE) return null
  try {
    // electron-builder writes this for deb/rpm/pacman packages.
    const t = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
    if (t === 'deb' || t === 'rpm' || t === 'pacman') return t
  } catch {
    // no marker: the tar.gz build
  }
  return 'tar.gz'
}

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
  installKind = status.mode === 'notify' ? detectInstallKind() : null

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
  if (status.mode === 'disabled' || ['checking', 'downloading', 'ready', 'downloaded'].includes(status.state)) return status

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
    // github.com/<repo>/releases/latest redirects to /releases/tag/<tag> of the latest published release.
    const res = await fetch(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'manual' })
    const tag = /\/releases\/tag\/([^/?#]+)/.exec(res.headers.get('location') ?? '')?.[1]
    if (!tag) {
      if (res.status >= 300 && res.status < 400) set({ state: 'up-to-date', lastChecked: Date.now() }) // no published release
      else throw new Error(`GitHub returned ${res.status}`)
      return status
    }
    const latest = decodeURIComponent(tag).replace(/^v/, '')
    if (!isNewer(latest, status.currentVersion)) {
      set({ state: 'up-to-date', lastChecked: Date.now() })
      return status
    }
    const releaseUrl = `https://github.com/${REPO}/releases/tag/${tag}`
    const name = installKind ? assetName(installKind, process.arch, latest) : null
    assetUrl = null
    if (name) {
      const url = `https://github.com/${REPO}/releases/download/${tag}/${name}`
      const head = await fetch(url, { method: 'HEAD', redirect: 'manual' })
      if (head.status >= 200 && head.status < 400) assetUrl = url
    }
    set({ state: 'available', version: latest, releaseUrl, assetName: assetUrl ? name! : undefined, lastChecked: Date.now() })
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
  }
  return status
}

/** The Downloads folder. Without an xdg-user-dirs entry Electron reports the home folder itself. */
function downloadsDir(): string {
  const dir = app.getPath('downloads')
  const fallback = join(homedir(), 'Downloads')
  return dir === homedir() && existsSync(fallback) ? fallback : dir
}

/** Download the matching release file into the Downloads folder. */
async function downloadAsset(): Promise<void> {
  if (!assetUrl || !status.assetName) return
  const file = join(downloadsDir(), status.assetName)
  const partial = `${file}.part`
  set({ state: 'downloading', progress: 0, error: undefined })
  try {
    const res = await fetch(assetUrl)
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    if (!(existsSync(file) && total && statSync(file).size === total)) {
      let received = 0
      let lastPct = -1
      const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
      body.on('data', (chunk: Buffer) => {
        received += chunk.length
        const pct = total ? Math.floor((received / total) * 100) : 0
        if (pct !== lastPct) {
          lastPct = pct
          set({ progress: pct })
        }
      })
      await pipeline(body, createWriteStream(partial))
      renameSync(partial, file)
    } else {
      await res.body.cancel()
    }
    const zypper = existsSync('/usr/bin/zypper')
    set({ state: 'downloaded', file, progress: 100, installCommand: installKind ? installCommand(installKind, file, { zypper }) ?? undefined : undefined })
  } catch (e) {
    rmSync(partial, { force: true })
    set({ state: 'available', error: `Download failed: ${(e as Error).message}` })
  }
}

/**
 * The one "do the next step" action: restart into a downloaded auto-update, download the
 * matching package, open a downloaded package (e.g. in Discover / GNOME Software), or fall
 * back to the release page when there's no file for this install.
 */
export async function installUpdate(): Promise<void> {
  if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true))
  else if (status.state === 'available' && assetUrl) await downloadAsset()
  else if (status.state === 'downloaded' && status.file) {
    // Packages open in the software centre; the portable exe and tar.gz are shown in their folder.
    if (installKind === 'portable' || installKind === 'tar.gz' || (await shell.openPath(status.file))) shell.showItemInFolder(status.file)
  } else if (status.releaseUrl) shell.openExternal(status.releaseUrl)
}

export function showUpdateFile(): void {
  if (status.file) shell.showItemInFolder(status.file)
}

export function openReleasePage(): void {
  if (status.releaseUrl) shell.openExternal(status.releaseUrl)
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
