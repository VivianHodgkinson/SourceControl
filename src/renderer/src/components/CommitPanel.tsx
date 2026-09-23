import { useEffect, useState } from 'react'
import type { CommitDetail, FileChange } from '@shared/types'
import { commitMenu, stashApply, stashDrop, stashPop } from '../actions'
import { api } from '../api'
import { copy, fullDate, initials, laneColor, relTime, short } from '../format'
import { useRepo } from '../repo'
import { below, type MenuItem } from '../ui'
import { FileRow } from './FileRow'
import { Icon } from './Icon'

function useFiles(from: string | null, to: string): FileChange[] | null {
  const ctx = useRepo()
  const [files, setFiles] = useState<FileChange[] | null>(null)
  useEffect(() => {
    let live = true
    setFiles(null)
    if (!to) return
    api.changedFiles(ctx.path, from, to).then(
      (f) => live && setFiles(f),
      (e) => live && ctx.ui.toast(e.message, 'error')
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.path, from, to])
  return files
}

function FileList({ files, from, to }: { files: FileChange[] | null; from: string | null; to: string }) {
  const ctx = useRepo()
  const view = ctx.view
  const selected = view.kind === 'diff' && view.spec.kind === 'commit' && view.spec.to === to ? view.spec.file.path : null
  const adds = files?.reduce((n, f) => n + (f.additions ?? 0), 0) ?? 0
  const dels = files?.reduce((n, f) => n + (f.deletions ?? 0), 0) ?? 0

  const fileMenu = (f: FileChange): MenuItem[] => [
    { label: 'View diff', icon: 'split', onClick: () => ctx.setView({ kind: 'diff', spec: { kind: 'commit', from, to, file: f } }) },
    { label: 'File history', icon: 'history', onClick: () => ctx.setView({ kind: 'history', path: f.path }) },
    { label: 'Blame at this commit', icon: 'blame', onClick: () => ctx.setView({ kind: 'blame', path: f.path, rev: to }), disabled: f.type === 'D' },
    { separator: true },
    {
      label: 'Restore file to this version',
      icon: 'undo',
      disabled: f.type === 'D',
      onClick: async () => {
        const ok = await ctx.ui.confirm({ title: 'Restore file?', message: `Overwrite ${f.path} in your working directory with the version from ${short(to)}.`, confirmLabel: 'Restore', danger: true })
        if (ok) await ctx.run('Restoring file', () => api.checkoutFile(ctx.path, to, f.path), `Restored ${f.path}`)
      }
    },
    { label: 'Copy path', icon: 'copy', onClick: () => copy(f.path) }
  ]

  return (
    <>
      <div className="file-section-head">
        {files ? `${files.length} file${files.length === 1 ? '' : 's'} changed` : 'Loading files…'}
        <span className="grow" />
        {files && (
          <span className="stats mono">
            <span className="add">+{adds}</span>
            <span className="del">−{dels}</span>
          </span>
        )}
      </div>
      {files?.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          showStats
          selected={selected === f.path}
          onClick={() => ctx.setView({ kind: 'diff', spec: { kind: 'commit', from, to, file: f } })}
          onContextMenu={(e) => ctx.ui.menu(e, fileMenu(f))}
        />
      ))}
    </>
  )
}

export function CommitPanel({ hash }: { hash: string }) {
  const ctx = useRepo()
  const [detail, setDetail] = useState<CommitDetail | null>(null)

  useEffect(() => {
    let live = true
    api.commitDetail(ctx.path, hash).then(
      (d) => live && setDetail(d),
      (e) => live && ctx.ui.toast(e.message, 'error')
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.path, hash])

  const commit = ctx.data.commits.find((c) => c.hash === hash)
  if (!detail || detail.hash !== hash)
    return (
      <div className="panel-empty">
        <span className="spinner" />
      </div>
    )

  return (
    <div className="panel-scroll">
      <div className="block">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="sha-chip" title="Copy SHA" onClick={() => (copy(detail.hash), ctx.ui.toast('SHA copied'))}>
            <Icon name="commit" size={12} /> {short(detail.hash)}
          </button>
          <span className="grow" />
          {commit && (
            <button className="icon-btn" title="Actions" onClick={(e) => ctx.ui.menu(below(e), commitMenu(ctx, commit))}>
              <Icon name="more" size={16} />
            </button>
          )}
        </div>
        <h2 className="selectable">{detail.subject}</h2>
        {detail.body && <div className="commit-body">{detail.body}</div>}
        <div className="author-row">
          <div className="avatar" style={{ background: laneColor(detail.author.length) }}>{initials(detail.author)}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{detail.author}</div>
            <div className="dim ellipsis" style={{ fontSize: 12 }} title={fullDate(detail.date)}>
              {detail.email} · {relTime(detail.date)}
            </div>
          </div>
        </div>
        <div className="meta" style={{ marginTop: 12 }}>
          {detail.committer !== detail.author && (
            <>
              <span className="k">Committer</span>
              <span>{detail.committer}</span>
            </>
          )}
          <span className="k">Date</span>
          <span>{fullDate(detail.date)}</span>
          <span className="k">{detail.parents.length > 1 ? 'Parents' : 'Parent'}</span>
          <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {detail.parents.length ? (
              detail.parents.map((p) => (
                <button key={p} className="sha-chip" onClick={() => ctx.focus(p)}>
                  {short(p)}
                </button>
              ))
            ) : (
              <span className="faint">none (root commit)</span>
            )}
          </span>
        </div>
      </div>
      <FileList files={detail.files} from={detail.parents[0] ?? null} to={detail.hash} />
    </div>
  )
}

export function ComparePanel({ a, b }: { a: string; b: string }) {
  const ctx = useRepo()
  const files = useFiles(a, b)
  const ca = ctx.data.commits.find((c) => c.hash === a)
  const cb = ctx.data.commits.find((c) => c.hash === b)
  return (
    <div className="panel-scroll">
      <div className="block">
        <h2>Comparing commits</h2>
        <div className="meta" style={{ marginTop: 10 }}>
          <span className="k">From</span>
          <span className="ellipsis">
            <button className="sha-chip" onClick={() => ctx.focus(a)}>{short(a)}</button> {ca?.subject}
          </span>
          <span className="k">To</span>
          <span className="ellipsis">
            <button className="sha-chip" onClick={() => ctx.focus(b)}>{short(b)}</button> {cb?.subject}
          </span>
        </div>
        <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Tip: Ctrl+click another commit in the graph to compare it.</div>
      </div>
      <FileList files={files} from={a} to={b} />
    </div>
  )
}

export function StashPanel() {
  const ctx = useRepo()
  const sel = ctx.selection
  const s = sel?.kind === 'stash' ? sel.stash : null
  const files = useFiles(s ? `${s.sha}^1` : null, s?.sha ?? '')
  if (!s) return null
  return (
    <div className="panel-scroll">
      <div className="block">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="sha-chip">
            <Icon name="stash" size={12} /> {s.ref}
          </span>
          <span className="dim" style={{ fontSize: 12 }}>{relTime(s.date)}</span>
        </div>
        <h2>{s.message}</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn small primary" onClick={() => stashPop(ctx, s)}>
            <Icon name="pop" size={13} /> Pop
          </button>
          <button className="btn small" onClick={() => stashApply(ctx, s)}>Apply</button>
          <span className="grow" />
          <button className="btn small danger" onClick={() => stashDrop(ctx, s)}>
            <Icon name="trash" size={13} /> Drop
          </button>
        </div>
      </div>
      <FileList files={files} from={`${s.sha}^1`} to={s.sha} />
    </div>
  )
}
