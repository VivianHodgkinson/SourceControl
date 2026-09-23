import { useEffect, useRef } from 'react'
import type { LogEntry } from '@shared/types'
import { Icon } from './Icon'

const quote = (a: string): string => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)

export function Console({ entries, onClear, onClose }: { entries: LogEntry[]; onClear: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])
  return (
    <div className="console">
      <div className="view-head">
        <Icon name="terminal" size={14} className="accent" />
        <div className="title">Git console</div>
        <span className="faint" style={{ fontSize: 12 }}>Every git command the app runs</span>
        <button className="btn small ghost" onClick={onClear}>Clear</button>
        <button className="icon-btn" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="console-body" ref={ref}>
        {entries.map((e) => (
          <div key={e.id} className={`console-entry${e.code !== 0 ? ' fail' : ''}`}>
            <span className="cmd">git {e.args.map(quote).join(' ')}</span>
            <span className="meta-t">
              {new Date(e.time).toLocaleTimeString()} · {e.duration}ms{e.code !== 0 ? ` · exit ${e.code}` : ''}
            </span>
            {e.stderr.trim() && <div className="err">{e.stderr.trim()}</div>}
          </div>
        ))}
        {!entries.length && <div className="console-entry faint">No commands yet.</div>}
      </div>
    </div>
  )
}
