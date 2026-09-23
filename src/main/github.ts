import type { GitHubRepo } from '@shared/types'
import { remotes } from './git'

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SourceControl-Git-Client',
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message?: string }[] }
    const detail = body.errors?.map((e) => e.message).filter(Boolean).join('; ')
    throw new Error(`GitHub: ${body.message ?? res.statusText}${detail ? ` (${detail})` : ''}`)
  }
  return res.json() as Promise<T>
}

export async function getUser(token: string): Promise<string> {
  const u = await gh<{ login: string }>(token, '/user')
  return u.login
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await gh<
      { full_name: string; clone_url: string; ssh_url: string; private: boolean; description: string | null; updated_at: string }[]
    >(token, `/user/repos?per_page=100&sort=updated&page=${page}`)
    all.push(
      ...batch.map((r) => ({
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        sshUrl: r.ssh_url,
        private: r.private,
        description: r.description,
        updatedAt: r.updated_at
      }))
    )
    if (batch.length < 100) break
  }
  return all
}

export function parseGitHubUrl(url: string): { owner: string; name: string } | null {
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url)
  return m ? { owner: m[1], name: m[2] } : null
}

export async function gitHubRemote(repo: string): Promise<{ owner: string; name: string; remote: string } | null> {
  const rs = await remotes(repo)
  const ordered = [...rs.filter((r) => r.name === 'upstream'), ...rs.filter((r) => r.name === 'origin'), ...rs]
  for (const r of ordered) {
    const parsed = parseGitHubUrl(r.url)
    if (parsed) return { ...parsed, remote: r.name }
  }
  return null
}

export async function createPullRequest(
  token: string,
  owner: string,
  name: string,
  pr: { title: string; body: string; head: string; base: string; draft: boolean }
): Promise<string> {
  const res = await gh<{ html_url: string }>(token, `/repos/${owner}/${name}/pulls`, {
    method: 'POST',
    body: JSON.stringify(pr)
  })
  return res.html_url
}
