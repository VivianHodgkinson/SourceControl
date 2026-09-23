import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@shared/types'
import { discardFiles, push, stash, workingFileMenu } from '../actions'
import { api } from '../api'
import { useRepo } from '../repo'
import { FileRow } from './FileRow'
import { Icon } from './Icon'

export function WorkingPanel() {
  const ctx = useRepo()
  const { status, state } = ctx.data
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const savedBeforeAmend = useRef<{ summary: string; description: string } | null>(null)

  const view = ctx.view
  const selectedPath = view.kind === 'diff' && view.spec.kind === 'working' ? `${view.spec.staged ? 's' : 'u'}:${view.spec.file.path}` : view.kind === 'conflict' ? `c:${view.path}` : null

  // Prefill the message git prepared for merges, reverts and cherry-picks.
  useEffect(() => {
    if (!state?.operation || summary) return
    api.readFile(ctx.path, `${state.gitDir}/MERGE_MSG`).then((msg) => {
      if (!msg) return
      const lines = msg.split('\n').filter((l) => !l.startsWith('#'))
      setSummary(lines[0] ?? '')
      setDescription(lines.slice(1).join('\n').trim())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.operation, state?.gitDir, ctx.path])

  const toggleAmend = async (on: boolean): Promise<void> => {
    setAmend(on)
    if (on) {
      savedBeforeAmend.current = { summary, description }
      const msg = await api.lastCommitMessage(ctx.path)
      const [s, ...rest] = msg.split('\n')
      setSummary(s ?? '')
      setDescription(rest.join('\n').trim())
    } else if (savedBeforeAmend.current) {
      setSummary(savedBeforeAmend.current.summary)
      setDescription(savedBeforeAmend.current.description)
    }
  }

  const open = (file: FileChange, staged: boolean): void => ctx.setView({ kind: 'diff', spec: { kind: 'working', file, staged } })

  const canCommit = summary.trim().length > 0 && (status.staged.length > 0 || amend) && status.conflicted.length === 0

  const commit = async (andPush: boolean): Promise<void> => {
    if (!canCommit) return
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    const ok = await ctx.run(amend ? 'Amending commit' : 'Committing', () => api.commit(ctx.path, message, amend), amend ? 'Commit amended' : 'Committed')
    if (!ok) return
    setSummary('')
    setDescription('')
    setAmend(false)
    savedBeforeAmend.current = null
    if (view.kind === 'diff') ctx.setView({ kind: 'graph' })
    if (andPush) await push(ctx)
  }

  const total = status.staged.length + status.unstaged.length + status.conflicted.length

  return (
    <>
      <div className="block row">
        <Icon name="edit" size={16} className="accent" />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>
            {total} file change{total === 1 ? '' : 's'}
          </div>
          <div className="dim" style={{ fontSize: 12 }}>
            on {state?.branch ?? 'detached HEAD'}
          </div>
        </div>
        <button className="btn small" onClick={() => stash(ctx)} disabled={!total} title="Stash all changes">
          <Icon name="stash" size={13} /> Stash
        </button>
      </div>
      <div className="panel-scroll">
        {status.conflicted.length > 0 && (
          <>
            <div className="file-section-head" style={{ color: 'var(--danger)' }}>
              <Icon name="alert" size={13} /> Conflicts <span className="count">{status.conflicted.length}</span>
            </div>
            {status.conflicted.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                selected={selectedPath === `c:${f.path}`}
                onClick={() => ctx.setView({ kind: 'conflict', path: f.path })}
                onContextMenu={(e) =>
                  ctx.ui.menu(e, [
                    { label: 'Resolve in editor', icon: 'edit', onClick: () => ctx.setView({ kind: 'conflict', path: f.path }) },
                    { label: 'Take ours (current branch)', icon: 'check', onClick: () => ctx.run('Resolving', () => api.resolveConflict(ctx.path, f.path, 'ours')) },
                    { label: 'Take theirs (incoming)', icon: 'check', onClick: () => ctx.run('Resolving', () => api.resolveConflict(ctx.path, f.path, 'theirs')) },
                    { label: 'Mark as resolved', icon: 'check', onClick: () => ctx.run('Resolving', () => api.resolveConflict(ctx.path, f.path, 'mark')) },
                    { separator: true },
                    { label: 'Open in external editor', icon: 'file', onClick: () => api.openPath(`${ctx.path}/${f.path}`) }
                  ])
                }
                actions={
                  <button className="icon-btn accent" title="Mark resolved" onClick={() => ctx.run('Resolving', () => api.resolveConflict(ctx.path, f.path, 'mark'))}>
                    <Icon name="check" size={13} />
                  </button>
                }
              />
            ))}
          </>
        )}

        <div className="file-section-head">
          Unstaged files <span className="count">{status.unstaged.length}</span>
          <span className="grow" />
          {status.unstaged.length > 0 && (
            <>
              <button
                className="icon-btn danger"
                title="Discard all unstaged changes"
                onClick={async () => {
                  const ok = await ctx.ui.confirm({ title: 'Discard all changes?', message: 'All unstaged changes and untracked files will be permanently deleted.', confirmLabel: 'Discard all', danger: true })
                  if (ok) await ctx.run('Discarding', () => api.discardAll(ctx.path), 'All changes discarded')
                }}
              >
                <Icon name="trash" size={13} />
              </button>
              <button className="btn small" onClick={() => ctx.run('Staging', () => api.stageAll(ctx.path))}>
                Stage all
              </button>
            </>
          )}
        </div>
        {status.unstaged.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            selected={selectedPath === `u:${f.path}`}
            onClick={() => open(f, false)}
            onContextMenu={(e) => ctx.ui.menu(e, workingFileMenu(ctx, f, false))}
            actions={
              <>
                <button className="icon-btn danger" title="Discard changes" onClick={() => discardFiles(ctx, [f])}>
                  <Icon name="undo" size={13} />
                </button>
                <button className="icon-btn accent" title="Stage file" onClick={() => ctx.run('Staging', () => api.stage(ctx.path, [f.path]))}>
                  <Icon name="plus" size={14} />
                </button>
              </>
            }
          />
        ))}
        {!status.unstaged.length && <div className="empty-note" style={{ padding: '10px 14px' }}>No unstaged changes</div>}

        <div className="file-section-head">
          Staged files <span className="count">{status.staged.length}</span>
          <span className="grow" />
          {status.staged.length > 0 && (
            <button className="btn small" onClick={() => ctx.run('Unstaging', () => api.unstageAll(ctx.path))}>
              Unstage all
            </button>
          )}
        </div>
        {status.staged.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            selected={selectedPath === `s:${f.path}`}
            onClick={() => open(f, true)}
            onContextMenu={(e) => ctx.ui.menu(e, workingFileMenu(ctx, f, true))}
            actions={
              <button className="icon-btn danger" title="Unstage file" onClick={() => ctx.run('Unstaging', () => api.unstage(ctx.path, [f.path]))}>
                <Icon name="minus" size={14} />
              </button>
            }
          />
        ))}
        {!status.staged.length && <div className="empty-note" style={{ padding: '10px 14px' }}>Stage files to include them in the next commit</div>}
      </div>

      <div className="commit-box">
        <div className="summary-wrap">
          <input
            className="input"
            placeholder={amend ? 'Amended commit summary' : 'Commit summary'}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit(false)}
          />
          <span className={`count${summary.length > 72 ? ' over' : ''}`}>{72 - summary.length}</span>
        </div>
        <textarea
          className="textarea"
          placeholder="Description (optional)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit(false)}
        />
        <div className="row">
          <label className="checkbox grow">
            <input type="checkbox" checked={amend} disabled={!state?.headSha} onChange={(e) => toggleAmend(e.target.checked)} />
            Amend previous commit
          </label>
          <span className="kbd">Ctrl+Enter</span>
        </div>
        <div className="split-btn">
          <button className="btn primary" disabled={!canCommit} onClick={() => commit(false)}>
            {amend ? 'Amend commit' : `Commit ${status.staged.length ? `${status.staged.length} file${status.staged.length === 1 ? '' : 's'}` : 'changes'}`}
          </button>
          <button className="btn primary" disabled={!canCommit || !ctx.data.remotes.length} title="Commit and push" onClick={() => commit(true)}>
            <Icon name="push" size={14} />
          </button>
        </div>
        {status.conflicted.length > 0 && <div className="dim" style={{ fontSize: 12, color: 'var(--warn)' }}>Resolve all conflicts before committing.</div>}
      </div>
    </>
  )
}
