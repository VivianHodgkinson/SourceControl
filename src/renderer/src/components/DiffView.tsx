import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { discardFiles } from '../actions'
import { api } from '../api'
import { CHANGE_LABEL, short } from '../format'
import { buildPatch, parseDiff, toSplitRows, type DiffFile, type DiffLine, type Hunk } from '../lib/diff'
import { useRepo, type DiffSpec } from '../repo'
import { Icon } from './Icon'

const MAX_CHARS = 3_000_000

function useStored<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (localStorage.getItem(key) as T) || initial)
  return [
    v,
    (x: T) => {
      localStorage.setItem(key, x)
      setV(x)
    }
  ]
}

export function DiffView({ spec, embedded }: { spec: DiffSpec; embedded?: boolean }) {
  const ctx = useRepo()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  const [mode, setMode] = useStored<'unified' | 'split'>('sc.diffMode', 'unified')
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [picked, setPicked] = useState<{ hunk: number; lines: Set<number> } | null>(null)
  const anchor = useRef<{ hunk: number; idx: number } | null>(null)

  const working = spec.kind === 'working'
  const file = spec.file
  const specKey = JSON.stringify(spec)
  const statusKey = working ? JSON.stringify(ctx.data.status) : ''

  useEffect(() => {
    let live = true
    const opts = { ignoreWhitespace: ignoreWs }
    const p =
      spec.kind === 'working'
        ? api.workingDiff(ctx.path, spec.file, spec.staged, opts)
        : api.fileDiff(ctx.path, spec.from, spec.to, spec.file.path, spec.file.oldPath, opts)
    p.then(
      (t) => {
        if (!live) return
        setText(t)
        setError(null)
      },
      (e) => live && setError(e.message)
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.path, specKey, ignoreWs, statusKey])

  useEffect(() => setPicked(null), [specKey, text])

  const tooBig = !force && text !== null && text.length > MAX_CHARS
  const diff: DiffFile | undefined = useMemo(() => (text && !tooBig ? parseDiff(text)[0] : undefined), [text, tooBig])

  const staged = spec.kind === 'working' && spec.staged
  const partial = working && file.type !== '?' && file.type !== 'U' && !diff?.binary && !ignoreWs

  const apply = async (hunkIdx: number, lines: Set<number> | null, action: 'stage' | 'unstage' | 'discard'): Promise<void> => {
    if (!diff) return
    const hunk = diff.hunks[hunkIdx]
    if (action === 'discard') {
      const ok = await ctx.ui.confirm({
        title: lines ? 'Discard selected lines?' : 'Discard hunk?',
        message: 'These changes will be permanently removed from your working directory.',
        confirmLabel: 'Discard',
        danger: true
      })
      if (!ok) return
    }
    const patch = buildPatch(diff, hunk, lines, action !== 'stage')
    const label = action === 'stage' ? 'Staging' : action === 'unstage' ? 'Unstaging' : 'Discarding'
    await ctx.run(label, () => api.applyPatch(ctx.path, patch, action !== 'discard', action !== 'stage'))
    setPicked(null)
  }

  const togglePick = (hunk: number, idx: number, shift: boolean): void => {
    if (!partial || !diff) return
    const lines = diff.hunks[hunk].lines
    if (lines[idx].type !== '+' && lines[idx].type !== '-') return
    setPicked((p) => {
      const set = new Set(p && p.hunk === hunk ? p.lines : [])
      if (shift && anchor.current && anchor.current.hunk === hunk) {
        const [a, b] = [anchor.current.idx, idx].sort((x, y) => x - y)
        for (let i = a; i <= b; i++) if (lines[i].type === '+' || lines[i].type === '-') set.add(i)
      } else if (set.has(idx)) set.delete(idx)
      else set.add(idx)
      anchor.current = { hunk, idx }
      return set.size ? { hunk, lines: set } : null
    })
  }

  const slash = file.path.lastIndexOf('/')
  const abs = `${ctx.path}/${file.path}`

  return (
    <div className="diff-view">
      <div className="view-head">
        <span className={`ftype ${file.type}`}>{file.type === '?' ? '+' : file.type}</span>
        <div className="title" title={file.path}>
          <span className="dir">{file.path.slice(0, slash + 1)}</span>
          {file.path.slice(slash + 1)}
          {file.oldPath && <span className="dir"> ← {file.oldPath}</span>}
          <span className="dir" style={{ marginLeft: 10, fontSize: 12 }}>
            {working ? (staged ? 'Staged' : CHANGE_LABEL[file.type]) : spec.kind === 'commit' ? `${spec.from ? short(spec.from) + '…' : ''}${short(spec.to)}` : ''}
          </span>
        </div>
        {diff && (
          <span className="stats mono">
            <span className="add">+{diff.additions}</span>
            <span className="del">−{diff.deletions}</span>
          </span>
        )}
        {working && !staged && (
          <>
            <button className="btn small danger" onClick={() => discardFiles(ctx, [file])}>
              <Icon name="undo" size={13} /> Discard file
            </button>
            <button className="btn small primary" onClick={() => ctx.run('Staging', () => api.stage(ctx.path, [file.path]))}>
              <Icon name="plus" size={13} /> Stage file
            </button>
          </>
        )}
        {staged && (
          <button className="btn small" onClick={() => ctx.run('Unstaging', () => api.unstage(ctx.path, [file.path]))}>
            <Icon name="minus" size={13} /> Unstage file
          </button>
        )}
        <div className="group">
          <button className={`icon-btn${mode === 'unified' ? ' active' : ''}`} title="Unified view" onClick={() => setMode('unified')}>
            <Icon name="unified" size={14} />
          </button>
          <button className={`icon-btn${mode === 'split' ? ' active' : ''}`} title="Split view" onClick={() => setMode('split')}>
            <Icon name="split" size={14} />
          </button>
        </div>
        <button className={`icon-btn${ignoreWs ? ' active' : ''}`} title="Ignore whitespace" onClick={() => setIgnoreWs(!ignoreWs)}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>¶</span>
        </button>
        {file.type !== 'D' && (
          <button className="icon-btn" title="Open file" onClick={() => api.openPath(abs).catch((e) => ctx.ui.toast(e.message, 'error'))}>
            <Icon name="file" size={14} />
          </button>
        )}
        {file.type !== '?' && file.type !== 'A' && !embedded && (
          <>
            <button className="icon-btn" title="File history" onClick={() => ctx.setView({ kind: 'history', path: file.path })}>
              <Icon name="history" size={14} />
            </button>
            <button className="icon-btn" title="Blame" onClick={() => ctx.setView({ kind: 'blame', path: file.path, rev: spec.kind === 'commit' ? spec.to : null })}>
              <Icon name="blame" size={14} />
            </button>
          </>
        )}
        {!embedded && (
          <button className="icon-btn" title="Close (Esc)" onClick={() => ctx.setView({ kind: 'graph' })}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <div className="diff-scroll">
        {error && <div className="diff-note">{error}</div>}
        {text === null && !error && (
          <div className="diff-note">
            <span className="spinner" style={{ display: 'inline-block' }} />
          </div>
        )}
        {tooBig && (
          <div className="diff-note">
            This diff is very large ({Math.round(text!.length / 1024)} KB).
            <div style={{ marginTop: 12 }}>
              <button className="btn small" onClick={() => setForce(true)}>Show anyway</button>
            </div>
          </div>
        )}
        {text !== null && !tooBig && !diff && !error && <div className="diff-note">No changes{ignoreWs ? ' (ignoring whitespace)' : ''}.</div>}
        {diff?.binary && <div className="diff-note">Binary file — no text diff available.</div>}
        {diff && !diff.binary && !diff.hunks.length && <div className="diff-note">{diff.header.find((h) => /mode|rename|similarity/.test(h)) ?? 'No content changes.'}</div>}
        {diff?.hunks.map((h, hi) => {
          const sel = picked?.hunk === hi ? picked.lines : null
          return (
            <Fragment key={hi}>
              <div className="hunk-head">
                <span className="label">{h.header}</span>
                {partial && !staged && (
                  <>
                    <button className="btn small ghost" onClick={() => apply(hi, sel, 'discard')}>
                      <Icon name="undo" size={12} /> Discard {sel ? `${sel.size} line${sel.size === 1 ? '' : 's'}` : 'hunk'}
                    </button>
                    <button className="btn small" onClick={() => apply(hi, sel, 'stage')}>
                      <Icon name="plus" size={12} /> Stage {sel ? `${sel.size} line${sel.size === 1 ? '' : 's'}` : 'hunk'}
                    </button>
                  </>
                )}
                {partial && staged && (
                  <button className="btn small" onClick={() => apply(hi, sel, 'unstage')}>
                    <Icon name="minus" size={12} /> Unstage {sel ? `${sel.size} line${sel.size === 1 ? '' : 's'}` : 'hunk'}
                  </button>
                )}
              </div>
              {mode === 'unified' ? (
                <UnifiedHunk hunk={h} hi={hi} selectable={partial} picked={sel} onPick={togglePick} />
              ) : (
                <SplitHunk hunk={h} />
              )}
            </Fragment>
          )
        })}
        {partial && diff && diff.hunks.length > 0 && mode === 'unified' && (
          <div className="diff-note" style={{ padding: 16, fontSize: 12 }}>
            Click line numbers to select individual lines (Shift+click for a range), then stage or discard just those lines.
          </div>
        )}
      </div>
    </div>
  )
}

function lineClass(l: DiffLine): string {
  return l.type === '+' ? 'add' : l.type === '-' ? 'del' : l.type === '\\' ? 'meta' : ''
}

function UnifiedHunk({
  hunk,
  hi,
  selectable,
  picked,
  onPick
}: {
  hunk: Hunk
  hi: number
  selectable: boolean
  picked: Set<number> | null
  onPick: (hunk: number, idx: number, shift: boolean) => void
}) {
  return (
    <>
      {hunk.lines.map((l, i) => {
        const changed = l.type === '+' || l.type === '-'
        const cls = `dl ${lineClass(l)}${selectable && changed ? ' selectable-line' : ''}${picked?.has(i) ? ' picked' : ''}`
        const pick = (e: React.MouseEvent): void => onPick(hi, i, e.shiftKey)
        return (
          <div key={i} className={cls}>
            <span className="ln o" onClick={pick}>{l.oldNo ?? ''}</span>
            <span className="ln n" onClick={pick}>{l.newNo ?? ''}</span>
            <span className="sign">{l.type === '\\' ? '' : l.type}</span>
            <span className="code">{l.type === '\\' ? l.text.slice(2) : l.text || ' '}</span>
          </div>
        )
      })}
    </>
  )
}

function SplitHunk({ hunk }: { hunk: Hunk }) {
  const rows = useMemo(() => toSplitRows(hunk), [hunk])
  const side = (l: (DiffLine & { idx: number }) | null, left: boolean, k: number) =>
    l ? (
      <div key={k} className={`dl ${l.type === ' ' ? '' : left ? 'del' : 'add'}`}>
        <span className="ln">{left ? l.oldNo : l.newNo}</span>
        <span className="sign">{l.type === ' ' ? '' : l.type}</span>
        <span className="code">{l.text || ' '}</span>
      </div>
    ) : (
      <div key={k} className="dl empty">
        <span className="ln" />
        <span className="code"> </span>
      </div>
    )
  return (
    <div className="split-diff">
      <div className="side">{rows.map((r, k) => side(r.left, true, k))}</div>
      <div className="side">{rows.map((r, k) => side(r.right, false, k))}</div>
    </div>
  )
}
