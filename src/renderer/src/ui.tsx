import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './components/Icon'

// ---------------------------------------------------------------- types

export interface Field {
  name: string
  label: string
  type?: 'text' | 'password' | 'textarea' | 'checkbox' | 'select'
  value?: string | boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  hint?: string
  required?: boolean
  mono?: boolean
}

export interface FormSpec {
  title: string
  icon?: IconName
  description?: string
  fields: Field[]
  submitLabel?: string
  danger?: boolean
  width?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormValues = Record<string, any>

export type MenuItem =
  | { label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { separator: true }
  | { header: string }

export interface UI {
  toast(message: string, kind?: 'success' | 'error' | 'info'): void
  form(spec: FormSpec): Promise<FormValues | null>
  confirm(spec: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>
  custom<T>(render: (done: (value: T | null) => void) => ReactNode): Promise<T | null>
  menu(at: { clientX: number; clientY: number }, items: MenuItem[]): void
}

/** Menu position just below the clicked button (for dropdowns opened by a left click). */
export function below(e: { currentTarget: EventTarget | null; clientX: number; clientY: number; type: string }): { clientX: number; clientY: number } {
  if (e.type === 'contextmenu' || !(e.currentTarget instanceof Element)) return e
  const el = e.currentTarget.closest('.tool, button') ?? e.currentTarget
  const r = el.getBoundingClientRect()
  return { clientX: r.left, clientY: r.bottom + 4 }
}

const UIContext = createContext<UI | null>(null)

export function useUI(): UI {
  const ui = useContext(UIContext)
  if (!ui) throw new Error('useUI outside provider')
  return ui
}

// ---------------------------------------------------------------- provider

interface Toast {
  id: number
  message: string
  kind: 'success' | 'error' | 'info'
}

let seq = 0

export function UIProvider({ children }: { children: ReactNode }) {
  const [modals, setModals] = useState<{ id: number; node: ReactNode }[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const toast = useCallback<UI['toast']>(
    (message, kind = 'success') => {
      const id = ++seq
      setToasts((t) => [...t.slice(-4), { id, message, kind }])
      setTimeout(() => dismiss(id), kind === 'error' ? 12000 : 4500)
    },
    [dismiss]
  )

  const custom = useCallback(<T,>(render: (done: (v: T | null) => void) => ReactNode): Promise<T | null> => {
    return new Promise((resolve) => {
      const id = ++seq
      const done = (v: T | null): void => {
        setModals((m) => m.filter((x) => x.id !== id))
        resolve(v)
      }
      setModals((m) => [...m, { id, node: render(done) }])
    })
  }, [])

  const form = useCallback<UI['form']>((spec) => custom<FormValues>((done) => <FormDialog spec={spec} done={done} />), [custom])

  const confirm = useCallback<UI['confirm']>(
    async ({ title, message, confirmLabel, danger }) =>
      (await custom<boolean>((done) => (
        <Dialog title={title} icon={danger ? 'alert' : 'check'} onClose={() => done(null)}
          footer={
            <>
              <button className="btn" onClick={() => done(null)}>Cancel</button>
              <button className={danger ? 'btn danger' : 'btn primary'} autoFocus onClick={() => done(true)}>
                {confirmLabel ?? 'OK'}
              </button>
            </>
          }
        >
          <div className="dialog-desc">{message}</div>
        </Dialog>
      ))) === true,
    [custom]
  )

  const showMenu = useCallback<UI['menu']>((at, items) => setMenu({ x: at.clientX, y: at.clientY, items }), [])

  const ui = useRef<UI>({ toast, form, confirm, custom, menu: showMenu })
  ui.current = { toast, form, confirm, custom, menu: showMenu }
  const [stable] = useState<UI>(() => ({
    toast: (...a) => ui.current.toast(...a),
    form: (...a) => ui.current.form(...a),
    confirm: (...a) => ui.current.confirm(...a),
    custom: (r) => ui.current.custom(r),
    menu: (...a) => ui.current.menu(...a)
  }))

  return (
    <UIContext.Provider value={stable}>
      {children}
      {modals.map((m) => (
        <div key={m.id}>{m.node}</div>
      ))}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} />
            <div className="msg">{t.message}</div>
            <button className="icon-btn" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
    </UIContext.Provider>
  )
}

// ---------------------------------------------------------------- dialog shell

export function Dialog({
  title,
  icon,
  width,
  children,
  footer,
  onClose
}: {
  title: string
  icon?: IconName
  width?: number
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={width ? { width } : undefined}>
        <div className="dialog-head">
          {icon && <Icon name={icon} size={18} />}
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

function FormDialog({ spec, done }: { spec: FormSpec; done: (v: FormValues | null) => void }) {
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : f.type === 'select' ? f.options?.[0]?.value ?? '' : '')]))
  )
  const missing = spec.fields.some((f) => f.required && !String(values[f.name] ?? '').trim())
  const set = (name: string, v: string | boolean): void => setValues((s) => ({ ...s, [name]: v }))
  const submit = (): void => {
    if (!missing) done(values)
  }

  return (
    <Dialog
      title={spec.title}
      icon={spec.icon}
      width={spec.width}
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>Cancel</button>
          <button className={spec.danger ? 'btn danger' : 'btn primary'} disabled={missing} onClick={submit}>
            {spec.submitLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {spec.description && <div className="dialog-desc">{spec.description}</div>}
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {spec.fields.map((f, i) => (
          <div className="field" key={f.name}>
            {f.type === 'checkbox' ? (
              <label className="checkbox">
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            ) : (
              <>
                <label>{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    className={f.mono ? 'textarea mono' : 'textarea'}
                    value={values[f.name]}
                    placeholder={f.placeholder}
                    autoFocus={i === 0}
                    onChange={(e) => set(f.name, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
                  />
                ) : f.type === 'select' ? (
                  <select className="select" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={f.mono ? 'input mono' : 'input'}
                    type={f.type === 'password' ? 'password' : 'text'}
                    value={values[f.name]}
                    placeholder={f.placeholder}
                    autoFocus={i === 0}
                    spellCheck={false}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
              </>
            )}
            {f.hint && <div className="hint">{f.hint}</div>}
          </div>
        ))}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------- context menu

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 6)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 6))
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: Event): void => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if ('separator' in item) return <div className="ms" key={i} />
        if ('header' in item) return <div className="mh" key={i}>{item.header}</div>
        return (
          <div
            key={i}
            className={`mi${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
          >
            {item.icon ? <Icon name={item.icon} size={14} /> : <span style={{ width: 14 }} />}
            {item.label}
          </div>
        )
      })}
    </div>
  )
}
