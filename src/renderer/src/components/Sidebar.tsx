import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { Branch, FlowKind } from '@shared/types'
import {
  addRemote,
  branchMenu,
  checkout,
  checkoutRemote,
  createBranch,
  createTag,
  flowFinish,
  flowInit,
  flowStart,
  remoteBranchMenu,
  remoteMenu,
  stash,
  stashMenu,
  tagMenu
} from '../actions'
import { useRepo } from '../repo'
import { Icon, type IconName } from './Icon'

function useCollapsed(key: string, initial = false): [boolean, () => void] {
  const storageKey = `sc.collapsed.${key}`
  const [v, setV] = useState(() => {
    const s = localStorage.getItem(storageKey)
    return s === null ? initial : s === '1'
  })
  return [
    v,
    () =>
      setV((x) => {
        localStorage.setItem(storageKey, x ? '0' : '1')
        return !x
      })
  ]
}

function Section({
  id,
  title,
  count,
  actions,
  children,
  initiallyCollapsed
}: {
  id: string
  title: string
  count?: number
  actions?: ReactNode
  children: ReactNode
  initiallyCollapsed?: boolean
}) {
  const [collapsed, toggle] = useCollapsed(id, initiallyCollapsed)
  return (
    <div>
      <div className="section-head" onClick={toggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={13} />
        {title}
        {count !== undefined && <span className="count">{count}</span>}
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      </div>
      {!collapsed && children}
    </div>
  )
}

interface TreeNode {
  name: string
  full: string
  children: Map<string, TreeNode>
  branch?: Branch
}

function buildTree(list: Branch[], strip: (b: Branch) => string): TreeNode {
  const root: TreeNode = { name: '', full: '', children: new Map() }
  for (const b of list) {
    const parts = strip(b).split('/')
    let node = root
    parts.forEach((p, i) => {
      const full = parts.slice(0, i + 1).join('/')
      if (!node.children.has(p)) node.children.set(p, { name: p, full, children: new Map() })
      node = node.children.get(p)!
    })
    node.branch = b
  }
  return root
}

function Tree({
  node,
  depth,
  idPrefix,
  render
}: {
  node: TreeNode
  depth: number
  idPrefix: string
  render: (b: Branch, name: string, depth: number) => ReactNode
}) {
  const entries = [...node.children.values()].sort((a, b) => {
    const af = a.children.size > 0 && !a.branch
    const bf = b.children.size > 0 && !b.branch
    if (af !== bf) return af ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return (
    <>
      {entries.map((n) =>
        n.children.size > 0 ? (
          <Folder key={n.full} node={n} depth={depth} idPrefix={idPrefix} render={render} />
        ) : n.branch ? (
          <div key={n.full}>{render(n.branch, n.name, depth)}</div>
        ) : null
      )}
    </>
  )
}

function Folder({ node, depth, idPrefix, render }: { node: TreeNode; depth: number; idPrefix: string; render: (b: Branch, name: string, depth: number) => ReactNode }) {
  const [collapsed, toggle] = useCollapsed(`${idPrefix}/${node.full}`)
  return (
    <>
      <div className="tree-item" style={{ paddingLeft: 12 + depth * 14 }} onClick={toggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="folder-icon" />
        <Icon name="folder" size={13} className="folder-icon" />
        <span className="name">{node.name}</span>
      </div>
      {node.branch && render(node.branch, node.name, depth + 1)}
      {!collapsed && <Tree node={node} depth={depth + 1} idPrefix={idPrefix} render={render} />}
    </>
  )
}

const FLOW_KINDS: { kind: FlowKind; label: string; icon: IconName }[] = [
  { kind: 'feature', label: 'Features', icon: 'feature' },
  { kind: 'bugfix', label: 'Bugfixes', icon: 'bugfix' },
  { kind: 'release', label: 'Releases', icon: 'release' },
  { kind: 'hotfix', label: 'Hotfixes', icon: 'hotfix' },
  { kind: 'support', label: 'Support', icon: 'support' }
]

export function Sidebar({ width }: { width: number }) {
  const ctx = useRepo()
  const { branches, tags, stashes, remotes, flow, state } = ctx.data
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const match = (s: string): boolean => !f || s.toLowerCase().includes(f)

  const local = useMemo(() => branches.filter((b) => !b.remote && match(b.name)), [branches, f])
  const remote = useMemo(() => branches.filter((b) => b.remote && match(b.name)), [branches, f])
  const shownTags = tags.filter((t) => match(t.name))
  const selectedHash = ctx.selection?.kind === 'commit' ? ctx.selection.hash : null
  const selectedStash = ctx.selection?.kind === 'stash' ? ctx.selection.stash.ref : null

  const menu = (e: MouseEvent, items: Parameters<typeof ctx.ui.menu>[1]): void => {
    e.preventDefault()
    ctx.ui.menu(e, items)
  }

  const renderLocal = (b: Branch, name: string, depth: number): ReactNode => (
    <div
      className={`tree-item${b.current ? ' current' : ''}${selectedHash === b.sha ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + depth * 14 + 13 }}
      title={`${b.name}\n${b.subject}`}
      onClick={() => ctx.focus(b.sha)}
      onDoubleClick={() => !b.current && checkout(ctx, b.name)}
      onContextMenu={(e) => menu(e, branchMenu(ctx, b))}
    >
      <Icon name={b.current ? 'check' : 'branch'} size={13} />
      <span className="name">{name}</span>
      {b.gone && <span className="pill-gone">gone</span>}
      {(b.ahead > 0 || b.behind > 0) && (
        <span className="track">
          {b.ahead > 0 && <span className="up">↑{b.ahead}</span>}
          {b.behind > 0 && <span className="down">↓{b.behind}</span>}
        </span>
      )}
    </div>
  )

  const renderRemote = (b: Branch, name: string, depth: number): ReactNode => (
    <div
      className={`tree-item${selectedHash === b.sha ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + depth * 14 + 13 }}
      title={b.name}
      onClick={() => ctx.focus(b.sha)}
      onDoubleClick={() => checkoutRemote(ctx, b.name)}
      onContextMenu={(e) => menu(e, remoteBranchMenu(ctx, b))}
    >
      <Icon name="branch" size={13} />
      <span className="name">{name}</span>
    </div>
  )

  return (
    <div className="sidebar" style={{ width }}>
      <div className="filter">
        <input className="input" placeholder="Filter branches, tags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="scroll">
        <Section
          id="local"
          title="Local"
          count={local.length}
          actions={
            <button className="icon-btn accent" title="New branch" onClick={() => createBranch(ctx)}>
              <Icon name="plus" size={13} />
            </button>
          }
        >
          {state?.detached && state.headSha && (
            <div className="tree-item current" style={{ paddingLeft: 25 }} onClick={() => ctx.focus(state.headSha!)}>
              <Icon name="commit" size={13} />
              <span className="name">HEAD (detached)</span>
            </div>
          )}
          <Tree node={buildTree(local, (b) => b.name)} depth={0} idPrefix="local" render={renderLocal} />
          {!local.length && <div className="empty-note">{f ? 'No matches' : 'No branches yet'}</div>}
        </Section>

        <Section
          id="remote"
          title="Remote"
          count={remotes.length}
          actions={
            <button className="icon-btn accent" title="Add remote" onClick={() => addRemote(ctx)}>
              <Icon name="plus" size={13} />
            </button>
          }
        >
          {remotes.map((r) => {
            const list = remote.filter((b) => b.remote === r.name)
            return (
              <RemoteGroup key={r.name} name={r.name} url={r.url} onMenu={(e) => menu(e, remoteMenu(ctx, r.name))}>
                <Tree node={buildTree(list, (b) => b.name.slice(r.name.length + 1))} depth={1} idPrefix={`remote/${r.name}`} render={renderRemote} />
              </RemoteGroup>
            )
          })}
          {!remotes.length && <div className="empty-note">No remotes</div>}
        </Section>

        <Section
          id="flow"
          title="Git Flow"
          actions={
            flow?.initialized ? (
              <button className="icon-btn accent" title="Start feature" onClick={() => flowStart(ctx, 'feature')}>
                <Icon name="plus" size={13} />
              </button>
            ) : undefined
          }
        >
          {flow?.initialized ? (
            <>
              {[flow.master, flow.develop].map((name) => {
                const b = branches.find((x) => !x.remote && x.name === name)
                return (
                  <div
                    key={name}
                    className={`tree-item${b?.current ? ' current' : ''}`}
                    style={{ paddingLeft: 25 }}
                    onClick={() => b && ctx.focus(b.sha)}
                    onDoubleClick={() => b && !b.current && checkout(ctx, name)}
                    onContextMenu={(e) => b && menu(e, branchMenu(ctx, b))}
                  >
                    <Icon name={b?.current ? 'check' : 'branch'} size={13} />
                    <span className="name">{name}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{name === flow.master ? 'production' : 'develop'}</span>
                  </div>
                )
              })}
              {FLOW_KINDS.map(({ kind, label, icon }) => {
                const prefix = flow.prefix[kind]
                const list = branches.filter((b) => !b.remote && b.name.startsWith(prefix) && match(b.name))
                return (
                  <FlowGroup key={kind} id={kind} label={label} icon={icon} count={list.length} onStart={() => flowStart(ctx, kind)}>
                    {list.map((b) => {
                      const name = b.name.slice(prefix.length)
                      return (
                        <div
                          key={b.name}
                          className={`tree-item${b.current ? ' current' : ''}${selectedHash === b.sha ? ' selected' : ''}`}
                          style={{ paddingLeft: 44 }}
                          onClick={() => ctx.focus(b.sha)}
                          onDoubleClick={() => !b.current && checkout(ctx, b.name)}
                          onContextMenu={(e) => menu(e, branchMenu(ctx, b))}
                        >
                          <Icon name={b.current ? 'check' : 'branch'} size={13} />
                          <span className="name">{name}</span>
                          {kind !== 'support' && (
                            <button
                              className="icon-btn accent"
                              style={{ width: 20, height: 20 }}
                              title={`Finish ${kind}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                flowFinish(ctx, kind, name)
                              }}
                            >
                              <Icon name="check" size={12} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </FlowGroup>
                )
              })}
            </>
          ) : (
            <div className="flow-init">
              Organise work into feature, release and hotfix branches with the Git Flow branching model.
              <button className="btn small primary block" onClick={() => flowInit(ctx)}>
                <Icon name="flow" size={13} /> Initialize Git Flow
              </button>
            </div>
          )}
        </Section>

        <Section
          id="tags"
          title="Tags"
          count={tags.length}
          initiallyCollapsed
          actions={
            <button className="icon-btn accent" title="New tag at HEAD" onClick={() => createTag(ctx, 'HEAD', 'HEAD')}>
              <Icon name="plus" size={13} />
            </button>
          }
        >
          {shownTags.map((t) => (
            <div
              key={t.name}
              className={`tree-item${selectedHash === t.sha ? ' selected' : ''}`}
              style={{ paddingLeft: 25 }}
              title={t.subject}
              onClick={() => ctx.focus(t.sha)}
              onContextMenu={(e) => menu(e, tagMenu(ctx, t))}
            >
              <Icon name="tag" size={13} />
              <span className="name">{t.name}</span>
            </div>
          ))}
          {!shownTags.length && <div className="empty-note">{f ? 'No matches' : 'No tags'}</div>}
        </Section>

        <Section
          id="stashes"
          title="Stashes"
          count={stashes.length}
          actions={
            <button className="icon-btn accent" title="Stash changes" onClick={() => stash(ctx)}>
              <Icon name="plus" size={13} />
            </button>
          }
        >
          {stashes.map((s) => (
            <div
              key={s.ref}
              className={`tree-item${selectedStash === s.ref ? ' selected' : ''}`}
              style={{ paddingLeft: 25 }}
              title={s.message}
              onClick={() => ctx.select({ kind: 'stash', stash: s })}
              onContextMenu={(e) => menu(e, stashMenu(ctx, s))}
            >
              <Icon name="stash" size={13} />
              <span className="name">{s.message.replace(/^(WIP on|On) [^:]+: /, '')}</span>
            </div>
          ))}
          {!stashes.length && <div className="empty-note">No stashes</div>}
        </Section>
      </div>
    </div>
  )
}

function RemoteGroup({ name, url, onMenu, children }: { name: string; url: string; onMenu: (e: MouseEvent) => void; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsed(`remote-group/${name}`)
  return (
    <>
      <div className="tree-item" style={{ paddingLeft: 12 }} title={url} onClick={toggle} onContextMenu={onMenu}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="folder-icon" />
        <Icon name="cloud" size={13} />
        <span className="name">{name}</span>
      </div>
      {!collapsed && children}
    </>
  )
}

function FlowGroup({ id, label, icon, count, onStart, children }: { id: string; label: string; icon: IconName; count: number; onStart: () => void; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsed(`flow/${id}`)
  return (
    <>
      <div className="tree-item" style={{ paddingLeft: 12 }} onClick={toggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="folder-icon" />
        <Icon name={icon} size={13} />
        <span className="name">{label}</span>
        <span className="faint" style={{ fontSize: 11 }}>{count || ''}</span>
        <button
          className="icon-btn accent"
          style={{ width: 20, height: 20 }}
          title={`Start ${id}`}
          onClick={(e) => {
            e.stopPropagation()
            onStart()
          }}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
      {!collapsed && children}
    </>
  )
}
