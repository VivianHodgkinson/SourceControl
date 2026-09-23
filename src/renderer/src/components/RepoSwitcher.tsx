import { useEffect, useMemo, useRef, useState } from 'react'
import { baseName } from '../format'
import { Icon } from './Icon'

interface Item {
  path: string
  name: string
  open: boolean
}

/** Match `query` against `text`: contiguous matches rank above scattered ones; -1 means no match. */
function score(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (!q) return 0
  const i = t.indexOf(q)
  if (i >= 0) return 1000 - i
  let pos = 0
  for (const ch of q) {
    pos = t.indexOf(ch, pos)
    if (pos < 0) return -1
    pos++
  }
  return 100 - pos
}

/** Ctrl+P palette: type to filter open and recent repos, Enter to switch. */
export function RepoSwitcher({
  tabs,
  recent,
  active,
  done
}: {
  tabs: string[]
  recent: string[]
  active: string | null
  done: (path: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const all: Item[] = [
      ...tabs.map((p) => ({ path: p, name: baseName(p), open: true })),
      ...recent.filter((p) => !tabs.includes(p)).map((p) => ({ path: p, name: baseName(p), open: false }))
    ]
    if (!query.trim()) return all
    // Name matches rank above matches elsewhere in the path.
    return all
      .map((it) => {
        // Names match loosely (letters in order); paths only as a plain substring, since a
        // long path contains almost any letters in order.
        const n = score(it.name, query)
        const p = it.path.toLowerCase().indexOf(query.toLowerCase())
        return { it, s: n >= 0 ? n + 2000 : p >= 0 ? 1000 - p : -1 }
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || Number(b.it.open) - Number(a.it.open))
      .map((x) => x.it)
  }, [tabs, recent, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[index]) done(items[index].path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      done(null)
    }
  }

  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" size={15} />
          <input
            autoFocus
            className="input"
            placeholder={`Switch repository… (${tabs.length} open)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => {
            const firstRecent = !query.trim() && !it.open && (i === 0 || items[i - 1].open)
            return (
              <div key={it.path}>
                {firstRecent && <div className="palette-group">Recent, not open</div>}
                <div
                  className={`palette-item${i === index ? ' on' : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => done(it.path)}
                >
                  <Icon name={it.path === active ? 'check' : 'repo'} size={14} />
                  <span className="name">{it.name}</span>
                  <span className="path ellipsis">{it.path}</span>
                </div>
              </div>
            )
          })}
          {!items.length && <div className="palette-empty">No repositories match “{query}”.</div>}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">↑↓</span> move</span>
          <span><span className="kbd">Enter</span> open</span>
          <span><span className="kbd">Esc</span> close</span>
          <span className="grow" />
          <span><span className="kbd">Ctrl+Tab</span> next tab</span>
        </div>
      </div>
    </div>
  )
}
