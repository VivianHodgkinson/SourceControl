import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '@shared/types'

interface StoredSettings extends Omit<Settings, 'hasGitHubToken'> {
  gitHubToken: string | null
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

let cache: StoredSettings | null = null

function load(): StoredSettings {
  if (cache) return cache
  const defaults: StoredSettings = {
    recentRepos: [],
    openTabs: [],
    activeTab: null,
    cloneDir: join(homedir(), 'dev'),
    gitHubUser: null,
    gitHubToken: null,
    pullMode: 'merge'
  }
  try {
    if (existsSync(file())) cache = { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    // Corrupt settings: fall back to defaults.
  }
  cache ??= defaults
  return cache
}

function persist(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}

export function getSettings(): Settings {
  const { gitHubToken, ...rest } = load()
  return { ...rest, hasGitHubToken: !!gitHubToken }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const { hasGitHubToken: _ignored, ...rest } = patch
  cache = { ...load(), ...rest }
  cache.recentRepos = [...new Set(cache.recentRepos)].slice(0, 20)
  persist()
  return getSettings()
}

export function getGitHubToken(): string | null {
  const stored = load().gitHubToken
  if (!stored) return null
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    return stored.slice(stored.indexOf(':') + 1)
  } catch {
    return null
  }
}

export function setGitHubToken(token: string | null, user: string | null): Settings {
  let stored: string | null = null
  if (token) {
    stored = safeStorage.isEncryptionAvailable()
      ? 'enc:' + safeStorage.encryptString(token).toString('base64')
      : 'plain:' + token
  }
  cache = { ...load(), gitHubToken: stored, gitHubUser: user }
  persist()
  return getSettings()
}
