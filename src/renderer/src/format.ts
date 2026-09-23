import type { ChangeType } from '@shared/types'

export const LANE_COLORS = [
  '#3ddc84', '#22d3ee', '#a3e635', '#f5c451', '#c084fc', '#fb7185', '#60a5fa', '#fb923c', '#2dd4bf', '#e879f9', '#facc15', '#4ade80'
]

export const laneColor = (i: number): string => LANE_COLORS[i % LANE_COLORS.length]

export function relTime(sec: number): string {
  const d = Date.now() / 1000 - sec
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`
  return new Date(sec * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export const fullDate = (sec: number): string => new Date(sec * 1000).toLocaleString()

export const short = (hash: string): string => hash.slice(0, 7)

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

export function dirName(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

export const CHANGE_LABEL: Record<ChangeType, string> = {
  A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflicted', '?': 'Untracked'
}

export function repoNameFromUrl(url: string): string {
  return baseName(url.trim().replace(/\.git\/?$/, '').replace(/[:]/g, '/')) || 'repo'
}

export function copy(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {})
}
