import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AskPassRequest, LogEntry, Settings } from '@shared/types'
import { api, on } from './api'
import { Console } from './components/Console'
import { AskPassDialog, SettingsDialog } from './components/dialogs'
import { Icon } from './components/Icon'
import { RepoView } from './components/RepoView'
import { Welcome } from './components/Welcome'
import { baseName } from './format'
import { resolveTheme, useTheme } from './theme'
import { useUI } from './ui'

export function App() {
  const ui = useUI()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  useTheme(settings?.theme)

  // Load settings and restore open tabs that still exist.
  useEffect(() => {
    api.getSettings().then(async (s) => {
      const alive: string[] = []
      for (const t of s.openTabs) if (await api.isRepo(t)) alive.push(t)
      setSettings(s)
      setTabs(alive)
      setActive(s.activeTab && alive.includes(s.activeTab) ? s.activeTab : alive[0] ?? null)
    })
  }, [])

  useEffect(() => {
    if (settings) api.saveSettings({ openTabs: tabs, activeTab: active }).catch(() => {})
  }, [tabs, active, settings])

  useEffect(() => on<LogEntry>('git:log', (e) => setLog((l) => [...l.slice(-400), e])), [])

  useEffect(
    () =>
      on<AskPassRequest>('askpass:request', async (req) => {
        const value = await ui.custom<string>((done) => <AskPassDialog prompt={req.prompt} done={done} />)
        window.bridge.respondAskPass(req.id, value)
      }),
    [ui]
  )

  const openRepo = useCallback(
    async (path: string) => {
      try {
        const state = await api.repoState(path)
        const root = state.path
        setTabs((t) => (t.includes(root) ? t : [...t, root]))
        setActive(root)
        const s = await api.getSettings()
        setSettings(await api.saveSettings({ recentRepos: [root, ...s.recentRepos.filter((r) => r !== root)] }))
      } catch (e) {
        ui.toast((e as Error).message, 'error')
      }
    },
    [ui]
  )

  const closeTab = (path: string): void => {
    api.unwatchRepo(path).catch(() => {})
    setTabs((t) => {
      const next = t.filter((x) => x !== path)
      if (active === path) setActive(next[Math.max(0, t.indexOf(path) - 1)] ?? null)
      return next
    })
  }

  const forget = async (path: string): Promise<void> => {
    if (!settings) return
    setSettings(await api.saveSettings({ recentRepos: settings.recentRepos.filter((r) => r !== path) }))
  }

  const toggleTheme = async (): Promise<void> => {
    if (!settings) return
    const next = resolveTheme(settings.theme) === 'dark' ? 'light' : 'dark'
    setSettings({ ...settings, theme: next })
    setSettings(await api.saveSettings({ theme: next }))
  }

  const openSettings = (): void => {
    if (!settings) return
    ui.custom<null>((done) => <SettingsDialog settings={settings} onSaved={setSettings} done={done} />)
  }

  const footer = (info: ReactNode): ReactNode => (
    <>
      {consoleOpen && <Console entries={log} onClear={() => setLog([])} onClose={() => setConsoleOpen(false)} />}
      <div className="statusbar">
        {info}
        <span className="grow" />
        <button className="item" onClick={() => setConsoleOpen(!consoleOpen)}>
          <Icon name="terminal" size={12} /> Console
          <span className="faint">{log.length}</span>
        </button>
      </div>
    </>
  )

  if (!settings) return <div className="app" />

  return (
    <div className="app">
      <div className="tabs">
        <div className="brand">
          <Icon name="logo" size={18} />
          <span>SourceControl</span>
        </div>
        {tabs.map((t) => (
          <div
            key={t}
            className={`tab${t === active ? ' active' : ''}`}
            title={t}
            onClick={() => setActive(t)}
            onAuxClick={(e) => e.button === 1 && closeTab(t)}
          >
            <Icon name="repo" size={13} />
            <span className="ellipsis">{baseName(t)}</span>
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t)
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <div className={`tab${active === null ? ' active' : ''}`} title="Open a repository" onClick={() => setActive(null)} style={{ paddingRight: 14 }}>
          <Icon name="plus" size={14} />
        </div>
        <span className="spacer" />
        <div className="tab-actions">
          <button
            className="icon-btn"
            title={resolveTheme(settings.theme) === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggleTheme}
          >
            <Icon name={resolveTheme(settings.theme) === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <button className="icon-btn" title="Settings" onClick={openSettings}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>

      {active ? (
        <RepoView key={active} path={active} settings={settings} footer={footer} />
      ) : (
        <>
          <Welcome settings={settings} onOpen={openRepo} onForget={forget} />
          {footer(<span className="item">Ready</span>)}
        </>
      )}
    </div>
  )
}
