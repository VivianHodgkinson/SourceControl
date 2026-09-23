import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Api, ApiMethod, IpcResult } from '@shared/api'
import type { AskPassRequest } from '@shared/types'
import { startAskPass, stopAskPass } from './askpass'
import * as git from './git'
import * as flow from './gitflow'
import * as github from './github'
import { configureRunner } from './runner'
import * as store from './store'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#080c0a' : '#ffffff',
    title: 'SourceControl',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools()
  })
  win.on('closed', () => (win = null))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------------------------------------------------------------- repo watching

const watchers = new Map<string, FSWatcher[]>()
const timers = new Map<string, NodeJS.Timeout>()

async function watchRepo(repo: string): Promise<void> {
  if (watchers.has(repo)) return
  const { gitDir } = await git.repoState(repo)
  const notify = (_ev: string, file: string | Buffer | null): void => {
    const name = file?.toString() ?? ''
    if (name.endsWith('.lock')) return
    clearTimeout(timers.get(repo))
    timers.set(repo, setTimeout(() => send('repo:changed', repo), 250))
  }
  const list: FSWatcher[] = []
  for (const [path, recursive] of [
    [gitDir, false],
    [join(gitDir, 'refs'), true]
  ] as const) {
    try {
      if (existsSync(path)) list.push(watch(path, { recursive }, notify))
    } catch {
      // Watching is best-effort; the UI also refreshes on focus.
    }
  }
  watchers.set(repo, list)
}

function unwatchRepo(repo: string): void {
  watchers.get(repo)?.forEach((w) => w.close())
  watchers.delete(repo)
}

// ---------------------------------------------------------------- terminal

function openTerminal(dir: string): Promise<void> {
  const candidates: [string, string[]][] =
    process.platform === 'darwin'
      ? [['open', ['-a', 'Terminal', dir]]]
      : process.platform === 'win32'
        ? [
            ['wt.exe', ['-d', dir]],
            ['cmd.exe', ['/c', 'start', 'cmd.exe']]
          ]
        : [
            ...(process.env.TERMINAL ? [[process.env.TERMINAL, []] as [string, string[]]] : []),
            ['konsole', ['--workdir', dir]],
            ['gnome-terminal', ['--working-directory', dir]],
            ['kgx', []],
            ['kitty', ['--directory', dir]],
            ['alacritty', ['--working-directory', dir]],
            ['wezterm', ['start', '--cwd', dir]],
            ['xfce4-terminal', ['--working-directory', dir]],
            ['x-terminal-emulator', []],
            ['xterm', []]
          ]
  return new Promise((resolve, reject) => {
    const attempt = (i: number): void => {
      if (i >= candidates.length) return reject(new Error('No terminal emulator found. Set the TERMINAL environment variable.'))
      const [cmd, args] = candidates[i]
      const child = spawn(cmd, args, { cwd: dir, detached: true, stdio: 'ignore' })
      child.once('error', () => attempt(i + 1))
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    }
    attempt(0)
  })
}

// ---------------------------------------------------------------- api

function requireToken(): string {
  const t = store.getGitHubToken()
  if (!t) throw new Error('Add a GitHub personal access token in Settings first.')
  return t
}

const api: Api = {
  getSettings: async () => store.getSettings(),
  saveSettings: async (patch) => {
    if (patch.theme) nativeTheme.themeSource = patch.theme
    return store.saveSettings(patch)
  },
  pickDirectory: async (title) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  watchRepo,
  unwatchRepo: async (repo) => unwatchRepo(repo),
  openPath: async (p) => {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  },
  showInFolder: async (p) => shell.showItemInFolder(p),
  openTerminal,
  openExternal: (url) => shell.openExternal(url),
  readFile: async (repo, path) => {
    const file = resolve(repo, path)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  },
  writeFile: async (repo, path, content) => writeFileSync(resolve(repo, path), content),
  getGlobalIdentity: async () => ({
    name: await git.getConfig(null, 'user.name'),
    email: await git.getConfig(null, 'user.email')
  }),
  setGlobalIdentity: async (name, email) => {
    await git.setConfig(null, 'user.name', name)
    await git.setConfig(null, 'user.email', email)
  },

  isRepo: git.isRepo,
  init: async (path) => {
    mkdirSync(path, { recursive: true })
    return git.init(path)
  },
  clone: async (url, dir, progressId) => {
    mkdirSync(join(dir, '..'), { recursive: true })
    try {
      return await git.clone(url, dir, (text) => send('progress', { id: progressId, text }))
    } finally {
      send('progress', { id: progressId, text: '', done: true })
    }
  },
  repoState: async (repo) => git.repoState(await git.toplevel(repo)),
  log: git.log,
  branches: git.branches,
  tags: git.tags,
  stashes: git.stashes,
  remotes: git.remotes,
  status: git.status,

  commitDetail: git.commitDetail,
  changedFiles: git.changedFiles,
  fileDiff: git.fileDiff,
  workingDiff: git.workingDiff,
  fileHistory: git.fileHistory,
  blame: git.blame,
  lastCommitMessage: git.lastCommitMessage,

  stage: git.stage,
  unstage: git.unstage,
  stageAll: git.stageAll,
  unstageAll: git.unstageAll,
  discard: git.discard,
  discardAll: git.discardAll,
  applyPatch: git.applyPatch,
  commit: git.commit,
  resolveConflict: git.resolveConflict,

  checkout: git.checkout,
  checkoutRemote: git.checkoutRemote,
  createBranch: git.createBranch,
  deleteBranch: git.deleteBranch,
  deleteRemoteBranch: git.deleteRemoteBranch,
  renameBranch: git.renameBranch,
  setUpstream: git.setUpstream,
  merge: git.merge,
  rebase: git.rebase,
  interactiveRebase: git.interactiveRebase,
  rebaseCommits: git.rebaseCommits,
  cherryPick: git.cherryPick,
  revert: git.revert,
  reset: git.reset,
  continueOperation: git.continueOperation,
  abortOperation: git.abortOperation,
  skipOperation: git.skipOperation,
  checkoutFile: git.checkoutFile,

  createTag: git.createTag,
  deleteTag: git.deleteTag,
  pushTag: git.pushTag,
  deleteRemoteTag: git.deleteRemoteTag,

  stashSave: git.stashSave,
  stashApply: git.stashApply,
  stashPop: git.stashPop,
  stashDrop: git.stashDrop,

  addRemote: git.addRemote,
  removeRemote: git.removeRemote,
  renameRemote: git.renameRemote,
  setRemoteUrl: git.setRemoteUrl,
  fetch: git.fetch,
  pull: git.pull,
  push: git.push,
  pushTags: git.pushTags,

  flowConfig: flow.flowConfig,
  flowInit: flow.flowInit,
  flowStart: flow.flowStart,
  flowFinish: flow.flowFinish,
  flowPublish: flow.flowPublish,

  setGitHubToken: async (token) => {
    if (!token) return store.setGitHubToken(null, null)
    const user = await github.getUser(token.trim())
    return store.setGitHubToken(token.trim(), user)
  },
  gitHubRepos: async () => github.listRepos(requireToken()),
  gitHubRemote: github.gitHubRemote,
  createPullRequest: async (repo, pr) => {
    const remote = await github.gitHubRemote(repo)
    if (!remote) throw new Error('No GitHub remote found for this repository.')
    return github.createPullRequest(requireToken(), remote.owner, remote.name, pr)
  }
}

ipcMain.handle('api', async (_e, method: ApiMethod, args: unknown[]): Promise<IpcResult<unknown>> => {
  try {
    const fn = api[method] as (...a: unknown[]) => Promise<unknown>
    if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`)
    return { ok: true, data: await fn(...args) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// ---------------------------------------------------------------- credentials

let askId = 0
const pendingAsks = new Map<number, (value: string | null) => void>()

ipcMain.on('askpass:respond', (_e, id: number, value: string | null) => {
  pendingAsks.get(id)?.(value)
  pendingAsks.delete(id)
})

async function askPass(prompt: string): Promise<string | null> {
  const token = store.getGitHubToken()
  if (token && /github\.com/i.test(prompt)) {
    if (/^username/i.test(prompt)) return 'x-access-token'
    if (/^password/i.test(prompt)) return token
  }
  if (!win) return null
  const req: AskPassRequest = { id: ++askId, prompt }
  send('askpass:request', req)
  return new Promise((resolve) => pendingAsks.set(req.id, resolve))
}

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = store.getSettings().theme
  const env = await startAskPass(askPass)
  configureRunner(env, (entry) => send('git:log', entry))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopAskPass()
  for (const repo of watchers.keys()) unwatchRepo(repo)
})
