import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api, on } from '../api'
import { relTime } from '../format'
import { Icon } from './Icon'

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    api.getUpdateStatus().then(setStatus, () => {})
    return on<UpdateStatus>('update:status', setStatus)
  }, [])
  return status
}

/** Top-bar indicator; only shown when there's something to act on. */
export function UpdatePill({ status }: { status: UpdateStatus | null }) {
  if (!status) return null
  if (status.state === 'ready')
    return (
      <button className="update-pill" title={`Version ${status.version} has been downloaded`} onClick={() => api.installUpdate()}>
        <Icon name="refresh" size={13} /> Restart to update
      </button>
    )
  if (status.state === 'available')
    return (
      <button className="update-pill" title="Open the release page to download it" onClick={() => api.installUpdate()}>
        <Icon name="download" size={13} /> v{status.version} available
      </button>
    )
  if (status.state === 'downloading')
    return (
      <span className="update-pill quiet" title={`Downloading version ${status.version}`}>
        <span className="spinner" /> Updating {status.progress ?? 0}%
      </span>
    )
  return null
}

function describe(s: UpdateStatus): string {
  if (s.mode === 'disabled') return 'Updates are turned off in development builds.'
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading version ${s.version}… ${s.progress ?? 0}%`
    case 'ready':
      return `Version ${s.version} is ready. Restart to install it.`
    case 'available':
      return `Version ${s.version} is available.`
    case 'up-to-date':
      return `You're up to date.${s.lastChecked ? ` Last checked ${relTime(s.lastChecked / 1000)}.` : ''}`
    case 'error':
      return `Couldn't check for updates: ${s.error}`
    default:
      return s.mode === 'auto' ? 'Updates download in the background and install when you restart.' : 'You will be told when a new version is released.'
  }
}

/** Updates block for the Settings dialog. */
export function UpdateSettings({ autoUpdate, setAutoUpdate }: { autoUpdate: boolean; setAutoUpdate: (v: boolean) => void }) {
  const status = useUpdateStatus()
  if (!status) return null
  const busy = status.state === 'checking' || status.state === 'downloading'
  return (
    <>
      <div className="row">
        <span className="grow">
          SourceControl <b>{status.currentVersion}</b>
        </span>
        {status.state === 'ready' || status.state === 'available' ? (
          <button className="btn small primary" onClick={() => api.installUpdate()}>
            {status.state === 'ready' ? 'Restart & update' : 'Download'}
          </button>
        ) : (
          <button className="btn small" disabled={busy || status.mode === 'disabled'} onClick={() => api.checkForUpdates()}>
            {busy ? <span className="spinner" /> : <Icon name="refresh" size={13} />} Check now
          </button>
        )}
      </div>
      <div className="hint" style={status.state === 'error' ? { color: 'var(--danger)' } : undefined}>
        {describe(status)}
      </div>
      {status.mode !== 'disabled' && (
        <label className="checkbox">
          <input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} />
          Check for updates automatically
        </label>
      )}
    </>
  )
}
