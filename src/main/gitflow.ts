import type { FlowFinishOptions, FlowKind, GitFlowConfig } from '@shared/types'
import { getConfig, isAncestor, refExists, remotes, repoState, setConfig } from './git'
import { git, run } from './runner'

/**
 * A native implementation of git-flow that reads and writes the same
 * `gitflow.*` config keys as git-flow (AVH), so repos initialised by either
 * tool work with the other. Finish operations are idempotent: if a merge stops
 * on conflicts, resolve and commit, then run finish again to carry on.
 */

const DEFAULTS: Omit<GitFlowConfig, 'initialized'> = {
  master: 'main',
  develop: 'develop',
  prefix: { feature: 'feature/', bugfix: 'bugfix/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versiontag: '' }
}

export async function flowConfig(repo: string): Promise<GitFlowConfig> {
  const [master, develop, feature, bugfix, release, hotfix, support, versiontag] = await Promise.all(
    [
      'gitflow.branch.master',
      'gitflow.branch.develop',
      'gitflow.prefix.feature',
      'gitflow.prefix.bugfix',
      'gitflow.prefix.release',
      'gitflow.prefix.hotfix',
      'gitflow.prefix.support',
      'gitflow.prefix.versiontag'
    ].map((k) => getConfig(repo, k))
  )
  const initialized = !!master && !!develop
  let defaultMaster = DEFAULTS.master
  if (!initialized && !(await refExists(repo, 'refs/heads/main')) && (await refExists(repo, 'refs/heads/master'))) {
    defaultMaster = 'master'
  }
  return {
    initialized,
    master: master || defaultMaster,
    develop: develop || DEFAULTS.develop,
    prefix: {
      feature: feature || DEFAULTS.prefix.feature,
      bugfix: bugfix || DEFAULTS.prefix.bugfix,
      release: release || DEFAULTS.prefix.release,
      hotfix: hotfix || DEFAULTS.prefix.hotfix,
      support: support || DEFAULTS.prefix.support,
      versiontag: versiontag
    }
  }
}

export async function flowInit(repo: string, cfg: Omit<GitFlowConfig, 'initialized'>): Promise<void> {
  if (cfg.master === cfg.develop) throw new Error('The production and development branches must be different.')
  const state = await repoState(repo)

  if (state.empty) {
    // git-flow bootstraps an empty repository with an initial commit on the production branch.
    await run(repo, ['symbolic-ref', 'HEAD', `refs/heads/${cfg.master}`])
    await run(repo, ['commit', '--allow-empty', '-m', 'Initial commit'])
  } else if (!(await refExists(repo, `refs/heads/${cfg.master}`))) {
    const remote = await firstRemoteWith(repo, cfg.master)
    if (remote) await run(repo, ['branch', '--track', cfg.master, `${remote}/${cfg.master}`])
    else throw new Error(`Production branch "${cfg.master}" does not exist.`)
  }

  if (!(await refExists(repo, `refs/heads/${cfg.develop}`))) {
    const remote = await firstRemoteWith(repo, cfg.develop)
    if (remote) await run(repo, ['branch', '--track', cfg.develop, `${remote}/${cfg.develop}`])
    else await run(repo, ['branch', '--no-track', cfg.develop, cfg.master])
  }

  await setConfig(repo, 'gitflow.branch.master', cfg.master)
  await setConfig(repo, 'gitflow.branch.develop', cfg.develop)
  for (const [k, v] of Object.entries(cfg.prefix)) await setConfig(repo, `gitflow.prefix.${k}`, v)

  await run(repo, ['checkout', cfg.develop])
}

async function firstRemoteWith(repo: string, branch: string): Promise<string | null> {
  for (const r of await remotes(repo)) {
    if (await refExists(repo, `refs/remotes/${r.name}/${branch}`)) return r.name
  }
  return null
}

async function requireInit(repo: string): Promise<GitFlowConfig> {
  const cfg = await flowConfig(repo)
  if (!cfg.initialized) throw new Error('Git Flow is not initialized in this repository.')
  return cfg
}

async function requireClean(repo: string): Promise<void> {
  const out = await run(repo, ['status', '--porcelain', '--untracked-files=no'], { quiet: true })
  if (out.trim()) throw new Error('You have uncommitted changes. Commit or stash them first.')
}

function defaultBase(cfg: GitFlowConfig, kind: FlowKind): string {
  return kind === 'hotfix' || kind === 'support' ? cfg.master : cfg.develop
}

export async function flowStart(repo: string, kind: FlowKind, name: string, base: string | null): Promise<void> {
  const cfg = await requireInit(repo)
  name = name.trim()
  if (!name) throw new Error('A name is required.')
  if (kind === 'support' && !base) throw new Error('Support branches need a base (usually a release tag).')
  const branch = cfg.prefix[kind] + name
  if (await refExists(repo, `refs/heads/${branch}`)) throw new Error(`Branch "${branch}" already exists.`)
  if (kind === 'release' || kind === 'hotfix') {
    const existing = (await run(repo, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${cfg.prefix[kind]}`], { quiet: true })).trim()
    if (existing) throw new Error(`There is already an open ${kind} branch: ${existing.split('\n')[0]}`)
  }
  // Uncommitted changes are carried over to the new branch, as with `git checkout -b`.
  await run(repo, ['checkout', '-b', branch, base || defaultBase(cfg, kind)])
}

export async function flowPublish(repo: string, kind: FlowKind, name: string): Promise<void> {
  const cfg = await requireInit(repo)
  const remote = await originName(repo)
  const branch = cfg.prefix[kind] + name
  await run(repo, ['push', '-u', remote, `refs/heads/${branch}:refs/heads/${branch}`])
}

async function originName(repo: string): Promise<string> {
  const rs = await remotes(repo)
  if (!rs.length) throw new Error('This repository has no remotes.')
  return (await getConfig(repo, 'gitflow.origin')) || rs.find((r) => r.name === 'origin')?.name || rs[0].name
}

/** Merge `source` into `target` unless it's already merged. */
async function mergeInto(repo: string, target: string, source: string, opts: FlowFinishOptions, message: string): Promise<void> {
  await run(repo, ['checkout', target])
  if (await isAncestor(repo, source, target)) return
  const args = ['merge']
  if (opts.squash) args.push('--squash')
  else if (opts.noFastForward !== false) args.push('--no-ff', '-m', message)
  const r = await git(repo, [...args, source], { allowFail: true })
  if (r.code !== 0) {
    throw new Error(
      `Merging ${source} into ${target} stopped with conflicts.\n` +
        'Resolve them and commit, then run Finish again to complete it.'
    )
  }
  if (opts.squash) await run(repo, ['commit', '--no-edit', '-m', message])
}

export async function flowFinish(repo: string, kind: FlowKind, name: string, opts: FlowFinishOptions): Promise<void> {
  const cfg = await requireInit(repo)
  if (kind === 'support') throw new Error('Support branches are long-lived and are not finished.')
  const branch = cfg.prefix[kind] + name
  if (!(await refExists(repo, `refs/heads/${branch}`))) throw new Error(`Branch "${branch}" does not exist.`)
  const state = await repoState(repo)
  if (state.operation) throw new Error(`A ${state.operation} is in progress. Complete or abort it first.`)
  await requireClean(repo)

  const pushTargets: string[] = []

  if (kind === 'feature' || kind === 'bugfix') {
    if (opts.rebase) {
      await run(repo, ['checkout', branch])
      await run(repo, ['rebase', cfg.develop])
    }
    await mergeInto(repo, cfg.develop, branch, opts, `Merge branch '${branch}' into ${cfg.develop}`)
    pushTargets.push(cfg.develop)
  } else {
    // release / hotfix: merge to production, tag, merge back to develop
    const tagName = cfg.prefix.versiontag + name
    await mergeInto(repo, cfg.master, branch, { ...opts, squash: false }, `Merge branch '${branch}' into ${cfg.master}`)
    if (!opts.noTag && !(await refExists(repo, `refs/tags/${tagName}`))) {
      await run(repo, ['tag', '-a', tagName, '-F', '-', cfg.master], { input: opts.tagMessage?.trim() || `${kind === 'release' ? 'Release' : 'Hotfix'} ${name}` })
    }
    // Hotfixes go to an open release branch instead of develop, as in git-flow.
    let backTarget = cfg.develop
    if (kind === 'hotfix') {
      const open = (await run(repo, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${cfg.prefix.release}`], { quiet: true })).trim()
      if (open) backTarget = open.split('\n')[0]
    }
    // Back-merge the tag (as git-flow AVH does) so it's reachable from develop and `git describe` works there.
    const tagged = await refExists(repo, `refs/tags/${tagName}`)
    const source = tagged ? tagName : cfg.master
    await mergeInto(repo, backTarget, source, { ...opts, squash: false }, `Merge ${tagged ? 'tag' : 'branch'} '${source}' into ${backTarget}`)
    pushTargets.push(cfg.master, backTarget)
  }

  if (!opts.keepBranch) {
    const current = (await repoState(repo)).branch
    if (current === branch) await run(repo, ['checkout', cfg.develop])
    await run(repo, ['branch', '-D', branch])
  }

  if (opts.push || opts.deleteRemote) {
    const remote = await originName(repo)
    if (opts.push) {
      for (const b of pushTargets) await run(repo, ['push', remote, `refs/heads/${b}:refs/heads/${b}`])
      if (kind === 'release' || kind === 'hotfix') await run(repo, ['push', remote, '--tags'])
    }
    if (opts.deleteRemote && (await refExists(repo, `refs/remotes/${remote}/${branch}`))) {
      await run(repo, ['push', remote, '--delete', branch])
    }
  }
}
