import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locate the git executable. Uses the user's configured path if set, then PATH.
 * On Windows it also checks the standard Git for Windows install folders, because
 * git is often not on PATH: the installer's "Git Bash only" option skips it, and an
 * app that was already running when git was installed still has the old PATH.
 */
export function findGit(configured: string | null): string | null {
  if (configured && works(configured)) return configured
  if (works('git')) return 'git'
  if (process.platform !== 'win32') return null
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
  const candidates = roots.filter((r): r is string => !!r).flatMap((r) => [join(r, 'Git', 'cmd', 'git.exe'), join(r, 'Git', 'bin', 'git.exe')])
  if (process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'))
  return candidates.find((c) => existsSync(c) && works(c)) ?? null
}

function works(bin: string): boolean {
  const r = spawnSync(bin, ['--version'], { windowsHide: true, timeout: 10000 })
  return !r.error && r.status === 0
}
