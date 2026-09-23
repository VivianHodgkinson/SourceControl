import { spawn } from 'node:child_process'
import type { LogEntry } from '@shared/types'

export interface RunOptions {
  input?: string
  /** Resolve instead of throwing on a non-zero exit code */
  allowFail?: boolean
  /** Skip the console log (used for high-frequency polling commands) */
  quiet?: boolean
  env?: Record<string, string>
  onStderr?: (chunk: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly stderr: string
  ) {
    super(message)
  }
}

let baseEnv: Record<string, string> = {}
let logSink: (entry: LogEntry) => void = () => {}
let nextId = 1
let locate: () => string | null = () => 'git'
let binary: string | null = null

export const GIT_MISSING =
  process.platform === 'win32'
    ? 'Git was not found. Install Git for Windows from https://git-scm.com/download/win, or set its location in Settings → Git executable.'
    : 'Git was not found. Install git with your package manager, or set its location in Settings → Git executable.'

export function configureRunner(env: Record<string, string>, sink: (entry: LogEntry) => void, findGit: () => string | null): void {
  baseEnv = env
  logSink = sink
  locate = findGit
  binary = null
}

/** The git executable in use, looking it up again if it wasn't found before (e.g. git installed while the app runs). */
export function gitBinary(): string | null {
  binary ??= locate()
  return binary
}

/** Forget the cached executable, e.g. after the configured path changes. */
export function resetGitBinary(): void {
  binary = null
}

/** Run `git <args>` in `cwd`. Output is decoded as UTF-8. */
export function git(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const start = Date.now()
  const fullArgs = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args]
  return new Promise((resolve, reject) => {
    const bin = gitBinary()
    if (!bin) {
      reject(new GitError(GIT_MISSING, null, ''))
      return
    }
    const child = spawn(bin, fullArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_EDITOR: 'true',
        LANGUAGE: 'C',
        LC_MESSAGES: 'C',
        ...baseEnv,
        ...opts.env
      },
      windowsHide: true
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      err.push(d)
      opts.onStderr?.(d.toString('utf8'))
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        resetGitBinary()
        reject(new GitError(GIT_MISSING, null, ''))
      } else reject(new GitError(`Failed to run git: ${e.message}`, null, ''))
    })
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (!opts.quiet) {
        logSink({ id: nextId++, cwd, args, time: start, duration: Date.now() - start, code, stderr: stderr.slice(0, 4000) })
      }
      if (code !== 0 && !opts.allowFail) {
        const msg = cleanError(stderr) || cleanError(stdout) || `git ${args[0]} exited with code ${code}`
        reject(new GitError(msg, code, stderr))
        return
      }
      resolve({ stdout, stderr, code })
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

/** Convenience wrapper that returns stdout and throws on failure. */
export async function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return (await git(cwd, args, opts)).stdout
}

function cleanError(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\r/g, '').trimEnd())
    .filter((l) => l && !/^(remote: )?(Counting|Compressing|Receiving|Resolving|Enumerating|Writing|Total)/.test(l))
    .join('\n')
    .trim()
}
