import { useEffect, useMemo, useState } from 'react'
import type { BlameLine, Commit } from '@shared/types'
import { api } from '../api'
import { fullDate, relTime, short } from '../format'
import { parseConflicts, type ConflictChunk } from '../lib/diff'
import { useRepo } from '../repo'
import { DiffView } from './DiffView'
import { Icon } from './Icon'

function ViewHead({ icon, title, sub, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub?: string; children?: React.ReactNode }) {
  const ctx = useRepo()
  return (
    <div className="view-head">
      <Icon name={icon} size={16} className="accent" />
      <div className="title">
        {title}
        {sub && <span className="dir" style={{ marginLeft: 8 }}>{sub}</span>}
      </div>
      {children}
      <button className="icon-btn" title="Close (Esc)" onClick={() => ctx.setView({ kind: 'graph' })}>
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- conflicts

type Choice = 'ours' | 'theirs' | 'both' | 'both-reverse'

export function ConflictView({ path }: { path: string }) {
  const ctx = useRepo()
  const [content, setContent] = useState<string | null | undefined>(undefined)
  const [choices, setChoices] = useState<Record<number, Choice>>({})

  useEffect(() => {
    setContent(undefined)
    setChoices({})
    api.readFile(ctx.path, path).then(setContent, () => setContent(null))
  }, [ctx.path, path])

  const chunks = useMemo<ConflictChunk[]>(() => (content ? parseConflicts(content) : []), [content])
  const conflictIdx = chunks.map((c, i) => (c.kind === 'conflict' ? i : -1)).filter((i) => i >= 0)
  const resolved = conflictIdx.filter((i) => choices[i]).length
  const allResolved = conflictIdx.length > 0 && resolved === conflictIdx.length
  const op = ctx.data.state?.operation
  // During a rebase "ours" is the branch being rebased onto; label accordingly.
  const oursName = op === 'rebase' ? 'upstream (onto)' : 'current branch'
  const theirsName = op === 'rebase' ? 'your commit' : 'incoming'

  const resolveText = (c: ConflictChunk, choice: Choice): string =>
    choice === 'ours' ? c.ours! : choice === 'theirs' ? c.theirs! : choice === 'both' ? [c.ours, c.theirs].filter(Boolean).join('\n') : [c.theirs, c.ours].filter(Boolean).join('\n')

  const save = async (): Promise<void> => {
    const out = chunks
      .map((c, i) => (c.kind === 'text' ? c.text! : resolveText(c, choices[i])))
      .filter((t, i) => chunks[i].kind === 'text' || t !== '')
      .join('\n')
    const ok = await ctx.run(
      'Resolving',
      async () => {
        await api.writeFile(ctx.path, path, out)
        await api.resolveConflict(ctx.path, path, 'mark')
      },
      `Resolved ${path}`
    )
    if (ok) ctx.setView({ kind: 'graph' })
  }

  const whole = async (side: 'ours' | 'theirs' | 'mark'): Promise<void> => {
    const ok = await ctx.run('Resolving', () => api.resolveConflict(ctx.path, path, side), `Resolved ${path}`)
    if (ok) ctx.setView({ kind: 'graph' })
  }

  const setAll = (c: Choice): void => setChoices(Object.fromEntries(conflictIdx.map((i) => [i, c])))

  return (
    <div className="diff-view">
      <ViewHead icon="alert" title={path} sub={conflictIdx.length ? `${resolved} of ${conflictIdx.length} conflicts resolved` : undefined}>
        <button className="btn small" onClick={() => api.openPath(`${ctx.path}/${path}`).catch((e) => ctx.ui.toast(e.message, 'error'))}>
          <Icon name="file" size={13} /> Open in editor
        </button>
        {conflictIdx.length > 0 && (
          <>
            <button className="btn small" onClick={() => setAll('ours')}>All ours</button>
            <button className="btn small" onClick={() => setAll('theirs')}>All theirs</button>
            <button className="btn small primary" disabled={!allResolved} onClick={save}>
              <Icon name="check" size={13} /> Save & mark resolved
            </button>
          </>
        )}
      </ViewHead>
      <div className="diff-scroll">
        {content === undefined && <div className="diff-note">Loading…</div>}
        {content !== undefined && !conflictIdx.length && (
          <div className="diff-note">
            {content === null ? 'This file was deleted on one side of the merge.' : 'No conflict markers found in this file.'}
            <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button className="btn small" onClick={() => whole('ours')}>Take {oursName}</button>
              <button className="btn small" onClick={() => whole('theirs')}>Take {theirsName}</button>
              {content !== null && (
                <button className="btn small primary" onClick={() => whole('mark')}>Mark as resolved</button>
              )}
            </div>
          </div>
        )}
        {conflictIdx.length > 0 &&
          chunks.map((c, i) =>
            c.kind === 'text' ? (
              <div key={i} className="plain-code">
                <pre>{c.text}</pre>
              </div>
            ) : (
              <div key={i} className={`conflict-block${choices[i] ? ' resolved' : ''}`}>
                <div className="cb-head">
                  <Icon name={choices[i] ? 'check' : 'alert'} size={13} />
                  <span className="grow">Conflict {conflictIdx.indexOf(i) + 1}</span>
                  {(['ours', 'theirs', 'both', 'both-reverse'] as Choice[]).map((ch) => (
                    <button key={ch} className={`btn small${choices[i] === ch ? ' primary' : ''}`} onClick={() => setChoices((s) => ({ ...s, [i]: ch }))}>
                      {ch === 'ours' ? 'Take ours' : ch === 'theirs' ? 'Take theirs' : ch === 'both' ? 'Ours then theirs' : 'Theirs then ours'}
                    </button>
                  ))}
                </div>
                {choices[i] ? (
                  <div className="cb-side ours">
                    <div className="cb-label">Result</div>
                    <pre>{resolveText(c, choices[i]) || ' '}</pre>
                  </div>
                ) : (
                  <>
                    <div className="cb-side ours">
                      <div className="cb-label">Ours — {oursName} {c.oursLabel && `(${c.oursLabel})`}</div>
                      <pre>{c.ours || ' '}</pre>
                    </div>
                    <div className="cb-side theirs">
                      <div className="cb-label">Theirs — {theirsName} {c.theirsLabel && `(${c.theirsLabel})`}</div>
                      <pre>{c.theirs || ' '}</pre>
                    </div>
                  </>
                )}
              </div>
            )
          )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- blame

export function BlameView({ path, rev }: { path: string; rev: string | null }) {
  const ctx = useRepo()
  const [lines, setLines] = useState<BlameLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLines(null)
    setError(null)
    api.blame(ctx.path, path, rev).then(setLines, (e) => setError(e.message))
  }, [ctx.path, path, rev])

  return (
    <div className="diff-view">
      <ViewHead icon="blame" title={path} sub={`Blame${rev ? ` at ${short(rev)}` : ''}`} />
      <div className="diff-scroll">
        {error && <div className="diff-note">{error}</div>}
        {!lines && !error && <div className="diff-note">Loading…</div>}
        {lines?.map((l, i) => {
          const first = i === 0 || lines[i - 1].hash !== l.hash
          const uncommitted = /^0+$/.test(l.hash)
          return (
            <div key={i} className={`blame-row${first ? ' first' : ''}`}>
              <div
                className="gut"
                title={first ? `${l.summary}\n${l.author}, ${fullDate(l.date)}` : undefined}
                onClick={() => !uncommitted && ctx.select({ kind: 'commit', hash: l.hash })}
              >
                {first && (
                  <>
                    <span className="mono" style={{ color: 'var(--accent)' }}>{uncommitted ? 'working' : short(l.hash)}</span>
                    <span className="ellipsis grow">{uncommitted ? 'Not committed yet' : l.author}</span>
                    <span className="faint">{uncommitted ? '' : relTime(l.date)}</span>
                  </>
                )}
              </div>
              <span className="ln">{l.line}</span>
              <span className="code">{l.content || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- file history

export function HistoryView({ path }: { path: string }) {
  const ctx = useRepo()
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [selected, setSelected] = useState<Commit | null>(null)

  useEffect(() => {
    setCommits(null)
    api.fileHistory(ctx.path, path).then(
      (c) => {
        setCommits(c)
        setSelected(c[0] ?? null)
      },
      (e) => ctx.ui.toast(e.message, 'error')
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.path, path])

  return (
    <div className="diff-view">
      <ViewHead icon="history" title={path} sub={commits ? `${commits.length} commit${commits.length === 1 ? '' : 's'}` : 'History'} />
      <div className="history-layout">
        <div className="history-list">
          {!commits && <div className="diff-note">Loading…</div>}
          {commits?.map((c) => (
            <div
              key={c.hash}
              className={`history-item${selected?.hash === c.hash ? ' selected' : ''}`}
              onClick={() => setSelected(c)}
              onDoubleClick={() => ctx.select({ kind: 'commit', hash: c.hash })}
            >
              <div className="s ellipsis">{c.subject}</div>
              <div className="m">
                <span className="mono">{short(c.hash)}</span> · {c.author} · {relTime(c.date)}
              </div>
            </div>
          ))}
        </div>
        <div className="center" style={{ background: 'var(--bg-0)' }}>
          {selected && (
            <DiffView embedded spec={{ kind: 'commit', from: selected.parents[0] ?? null, to: selected.hash, file: { path, type: 'M' } }} />
          )}
        </div>
      </div>
    </div>
  )
}
