import { useEffect } from 'react'
import type { Theme } from '@shared/types'

const KEY = 'sc.theme'
const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  return theme === 'system' ? (darkQuery().matches ? 'dark' : 'light') : theme
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable: the theme still applies for this session
  }
}

/** Apply the last-used theme before first render so light-mode users don't see a dark flash. */
export function applyCachedTheme(): void {
  let cached: string | null = null
  try {
    cached = localStorage.getItem(KEY)
  } catch {
    // ignore
  }
  applyTheme(cached === 'light' || cached === 'system' ? cached : 'dark')
}

/** Keep the document theme in sync with the setting, following the OS when set to "system". */
export function useTheme(theme: Theme | undefined): void {
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    if (theme !== 'system') return
    const q = darkQuery()
    const onChange = (): void => applyTheme('system')
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [theme])
}
