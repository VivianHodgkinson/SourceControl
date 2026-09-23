import type { MouseEvent, ReactNode } from 'react'
import type { FileChange } from '@shared/types'
import { CHANGE_LABEL } from '../format'

export function FileRow({
  file,
  selected,
  onClick,
  onContextMenu,
  actions,
  showStats
}: {
  file: FileChange
  selected?: boolean
  onClick?: () => void
  onContextMenu?: (e: MouseEvent) => void
  actions?: ReactNode
  showStats?: boolean
}) {
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const base = file.path.slice(slash + 1)
  const type = file.conflict ? 'U' : file.type
  return (
    <div
      className={`file-row${selected ? ' selected' : ''}`}
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        onContextMenu(e)
      }}
      title={`${CHANGE_LABEL[type]}: ${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}`}
    >
      <span className={`ftype ${type}`}>{type === '?' ? '+' : type}</span>
      <span className="path">
        <bdi>
          <span className="dir">{dir}</span>
          {base}
        </bdi>
      </span>
      {showStats && (file.additions !== undefined || file.deletions !== undefined) && (
        <span className="stats">
          {!!file.additions && <span className="add">+{file.additions}</span>}
          {!!file.deletions && <span className="del">−{file.deletions}</span>}
        </span>
      )}
      {actions && <span className="actions" onClick={(e) => e.stopPropagation()}>{actions}</span>}
    </div>
  )
}
