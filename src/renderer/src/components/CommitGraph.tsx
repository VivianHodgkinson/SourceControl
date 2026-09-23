import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Commit } from '@shared/types'
import { branchMenu, checkout, commitMenu, remoteBranchMenu, tagMenu } from '../actions'
import { initials, laneColor, relTime, short, fullDate } from '../format'
import { layoutGraph, type GraphRow } from '../lib/graph'
import { useRepo } from '../repo'
import { Icon } from './Icon'

const ROW_H = 30
const LANE_W = 20
const PAD = 8
const MAX_LANES = 18
export const WIP = 'WIP'

export function CommitGraph({ search }: { search: string }) {
  const ctx = useRepo()
  const { commits, status, state, branches, tags } = ctx.data
  const changes = status.staged.length + status.unstaged.length + status.conflicted.length

  const items = useMemo<Commit[]>(() => {
    if (!changes) return commits
    const wip: Commit = { hash: WIP, parents: state?.headSha ? [state.headSha] : [], author: '', email: '', date: Date.now() / 1000, subject: '', refs: [] }
    return [wip, ...commits]
  }, [commits, changes, state?.headSha])

  const layout = useMemo(() => layoutGraph(items), [items])
  const graphW = PAD * 2 + Math.min(layout.width, MAX_LANES) * LANE_W
  const cols = `190px ${graphW}px minmax(200px, 1fr) 150px 110px 76px`

  const bodyRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(800)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const indexOf = useMemo(() => new Map(items.map((c, i) => [c.hash, i])), [items])

  // Scroll a focused commit into view.
  useEffect(() => {
    const el = bodyRef.current
    if (!ctx.focusHash || !el) return
    const i = indexOf.get(ctx.focusHash.hash)
    if (i === undefined) {
      ctx.ui.toast('That commit is not in the loaded history. Load more commits to find it.', 'info')
      return
    }
    const top = i * ROW_H
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H * 2) el.scrollTop = top - el.clientHeight / 3
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.focusHash])

  const q = search.trim().toLowerCase()
  const matches = (c: Commit): boolean =>
    !q || c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q) || c.refs.some((r) => r.name.toLowerCase().includes(q))

  const sel = ctx.selection
  const selectedHash = sel?.kind === 'commit' ? sel.hash : sel?.kind === 'wip' ? WIP : sel?.kind === 'compare' ? sel.b : null
  const compareHash = sel?.kind === 'compare' ? sel.a : null

  const onRowClick = (e: MouseEvent, c: Commit): void => {
    if (c.hash === WIP) return ctx.select({ kind: 'wip' })
    if ((e.ctrlKey || e.metaKey) && sel?.kind === 'commit' && sel.hash !== c.hash) return ctx.select({ kind: 'compare', a: sel.hash, b: c.hash })
    ctx.select({ kind: 'commit', hash: c.hash })
  }

  const onRowDouble = (c: Commit): void => {
    const local = c.refs.find((r) => r.type === 'head' && !r.current)
    if (local) checkout(ctx, local.name)
  }

  const onRowMenu = (e: MouseEvent, c: Commit): void => {
    e.preventDefault()
    if (c.hash === WIP) return
    ctx.select({ kind: 'commit', hash: c.hash })
    ctx.ui.menu(e, commitMenu(ctx, c))
  }

  const onRefMenu = (e: MouseEvent, type: string, name: string): void => {
    e.preventDefault()
    e.stopPropagation()
    if (type === 'tag') {
      const t = tags.find((x) => x.name === name)
      if (t) ctx.ui.menu(e, tagMenu(ctx, t))
      return
    }
    const b = branches.find((x) => x.name === name && (type === 'remote') === !!x.remote)
    if (b) ctx.ui.menu(e, b.remote ? remoteBranchMenu(ctx, b) : branchMenu(ctx, b))
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const cur = selectedHash ? indexOf.get(selectedHash) ?? -1 : -1
    const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))
    const c = items[next]
    if (!c) return
    if (c.hash === WIP) ctx.select({ kind: 'wip' })
    else ctx.focus(c.hash)
    const el = bodyRef.current
    if (el) {
      const top = next * ROW_H
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_H) + 10)
  const headSha = state?.headSha

  return (
    <div className="graph" style={{ ['--cols' as string]: cols }} tabIndex={0} onKeyDown={onKey}>
      <div className="graph-header">
        <div>Branch / Tag</div>
        <div>Graph</div>
        <div>Commit message</div>
        <div>Author</div>
        <div>Date</div>
        <div>SHA</div>
      </div>
      <div className="graph-body" ref={bodyRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: items.length * ROW_H + (ctx.hasMore ? 50 : 0), position: 'relative' }}>
          {items.slice(start, end).map((c, k) => {
            const i = start + k
            const isWip = c.hash === WIP
            const row = layout.rows[i]
            const cls = ['graph-row']
            if (c.hash === selectedHash) cls.push('selected')
            if (c.hash === compareHash) cls.push('compare')
            if (c.hash === headSha) cls.push('head')
            if (q && !isWip) cls.push(matches(c) ? 'match' : 'dimmed')
            return (
              <div
                key={c.hash}
                className={cls.join(' ')}
                style={{ top: i * ROW_H }}
                onClick={(e) => onRowClick(e, c)}
                onDoubleClick={() => onRowDouble(c)}
                onContextMenu={(e) => onRowMenu(e, c)}
              >
                <div className="refs">
                  <Refs commit={c} color={laneColor(row.color)} onMenu={onRefMenu} onCheckout={(name) => checkout(ctx, name)} />
                </div>
                <div className="graph-cell">
                  <GraphCell row={row} width={graphW} wip={isWip} merge={c.parents.length > 1} head={c.hash === headSha} label={initials(c.author)} />
                </div>
                {isWip ? (
                  <div className="msg wip">
                    // Work in progress · {changes} changed file{changes === 1 ? '' : 's'}
                  </div>
                ) : (
                  <div className="msg" title={c.subject}>{c.subject}</div>
                )}
                <div className="author" title={isWip ? '' : `${c.author} <${c.email}>`}>{c.author}</div>
                <div className="date" title={isWip ? '' : fullDate(c.date)}>{isWip ? '' : relTime(c.date)}</div>
                <div className="sha">{isWip ? '' : short(c.hash)}</div>
              </div>
            )
          })}
          {ctx.hasMore && (
            <div className="load-more" style={{ position: 'absolute', top: items.length * ROW_H, left: 0, right: 0 }}>
              <button className="btn small" onClick={ctx.loadMore}>Load more commits</button>
            </div>
          )}
        </div>
        {!items.length && ctx.loaded && (
          <div className="panel-empty" style={{ position: 'absolute', inset: 0 }}>
            <Icon name="commit" size={32} />
            <div>No commits yet. Stage some files and make your first commit.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- refs column

function Refs({
  commit,
  color,
  onMenu,
  onCheckout
}: {
  commit: Commit
  color: string
  onMenu: (e: MouseEvent, type: string, name: string) => void
  onCheckout: (name: string) => void
}) {
  if (!commit.refs.length) return null
  const locals = commit.refs.filter((r) => r.type === 'head').sort((a, b) => Number(!!b.current) - Number(!!a.current))
  const remotes = commit.refs.filter((r) => r.type === 'remote')
  const used = new Set<string>()
  const pills: { type: 'head' | 'remote' | 'tag'; name: string; current?: boolean; synced?: string[] }[] = []
  for (const l of locals) {
    const synced = remotes.filter((r) => r.name.split('/').slice(1).join('/') === l.name)
    synced.forEach((r) => used.add(r.name))
    pills.push({ type: 'head', name: l.name, current: l.current, synced: synced.map((r) => r.name.split('/')[0]) })
  }
  for (const r of remotes) if (!used.has(r.name)) pills.push({ type: 'remote', name: r.name })
  for (const t of commit.refs.filter((r) => r.type === 'tag')) pills.push({ type: 'tag', name: t.name })

  const [first, ...rest] = pills
  const title = pills.map((p) => (p.type === 'tag' ? `tag: ${p.name}` : p.synced?.length ? `${p.name} (${p.synced.join(', ')})` : p.name)).join('\n')
  return (
    <>
      <span
        className={`ref ${first.type}${first.current ? ' current' : ''}`}
        style={{ ['--ref-color' as string]: color }}
        title={title}
        onContextMenu={(e) => onMenu(e, first.type, first.name)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (first.type === 'head' && !first.current) onCheckout(first.name)
        }}
      >
        {first.type === 'head' && first.current && <Icon name="check" size={11} />}
        {first.type === 'remote' && <Icon name="cloud" size={11} />}
        {first.type === 'tag' && <Icon name="tag" size={11} />}
        <span>{first.name}</span>
        {first.synced && first.synced.length > 0 && <Icon name="cloud" size={11} />}
      </span>
      {rest.length > 0 && (
        <span className="ref-more" title={title}>
          +{rest.length}
        </span>
      )}
    </>
  )
}

// ---------------------------------------------------------------- graph cell

const GraphCell = memo(function GraphCell({
  row,
  width,
  wip,
  merge,
  head,
  label
}: {
  row: GraphRow
  width: number
  wip: boolean
  merge: boolean
  head: boolean
  label: string
}) {
  const x = (lane: number): number => PAD + lane * LANE_W + LANE_W / 2
  const cx = x(row.col)
  const cy = ROW_H / 2
  const color = laneColor(row.color)
  return (
    <svg width={width} height={ROW_H}>
      <g fill="none" strokeWidth={2} strokeLinecap="round">
        {row.pass.map((p) => (
          <line key={`p${p.lane}`} x1={x(p.lane)} y1={0} x2={x(p.lane)} y2={ROW_H} style={{ stroke: laneColor(p.color) }} />
        ))}
        {row.shift.map((p) => (
          <path
            key={`s${p.from}`}
            d={`M ${x(p.from)} 0 C ${x(p.from)} ${cy}, ${x(p.lane)} ${cy}, ${x(p.lane)} ${ROW_H}`}
            style={{ stroke: laneColor(p.color) }}
          />
        ))}
        {row.incoming.map((p) => (
          <path
            key={`i${p.lane}`}
            d={p.lane === row.col ? `M ${cx} 0 L ${cx} ${cy}` : `M ${x(p.lane)} 0 Q ${x(p.lane)} ${cy} ${cx} ${cy}`}
            style={{ stroke: laneColor(p.color) }}
          />
        ))}
        {row.outgoing.map((p) => (
          <path
            key={`o${p.lane}`}
            d={p.lane === row.col ? `M ${cx} ${cy} L ${cx} ${ROW_H}` : `M ${cx} ${cy} Q ${x(p.lane)} ${cy} ${x(p.lane)} ${ROW_H}`}
            style={{ stroke: laneColor(p.color) }}
            strokeDasharray={wip ? '3 3' : undefined}
          />
        ))}
      </g>
      {wip ? (
        <circle cx={cx} cy={cy} r={7} style={{ fill: 'var(--bg-1)', stroke: color }} strokeWidth={2} strokeDasharray="3 2" />
      ) : merge ? (
        <circle cx={cx} cy={cy} r={5} style={{ fill: 'var(--bg-1)', stroke: color }} strokeWidth={2.5} />
      ) : (
        <>
          {head && <circle cx={cx} cy={cy} r={12} fill="none" style={{ stroke: color }} strokeWidth={1.5} opacity={0.6} />}
          <circle cx={cx} cy={cy} r={9} style={{ fill: color }} />
          <text x={cx} y={cy + 3.2} textAnchor="middle" fontSize={8.5} fontWeight={700} style={{ fill: 'var(--node-ink)', fontFamily: 'var(--font)' }}>
            {label}
          </text>
        </>
      )}
    </svg>
  )
})
