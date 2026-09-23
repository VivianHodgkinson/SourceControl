export interface DiffLine {
  type: ' ' | '+' | '-' | '\\'
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface Hunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffFile {
  /** Lines from `diff --git` up to (and including) `+++` */
  header: string[]
  hunks: Hunk[]
  binary: boolean
  additions: number
  deletions: number
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0

  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      file = { header: [line], hunks: [], binary: false, additions: 0, deletions: 0 }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (!hunk && !m) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true
      file.header.push(line)
      continue
    }
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[2])
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const t = line[0] as DiffLine['type'] | undefined
    const body = line.slice(1)
    if (t === '+') {
      hunk.lines.push({ type: '+', text: body, oldNo: null, newNo: newNo++ })
      file.additions++
    } else if (t === '-') {
      hunk.lines.push({ type: '-', text: body, oldNo: oldNo++, newNo: null })
      file.deletions++
    } else if (t === '\\') {
      hunk.lines.push({ type: '\\', text: line, oldNo: null, newNo: null })
    } else {
      hunk.lines.push({ type: ' ', text: body, oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return files
}

/**
 * Build a patch containing one hunk, optionally limited to selected +/- line
 * indices. `reverse` states how the patch will be applied (git apply -R):
 * unselected changes must then be kept as context on the *new* side instead of
 * the old side.
 */
export function buildPatch(file: DiffFile, hunk: Hunk, selected: Set<number> | null, reverse: boolean): string {
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let lastKept = true
  hunk.lines.forEach((l, i) => {
    const sel = selected === null || selected.has(i)
    if (l.type === '\\') {
      if (lastKept) out.push(l.text)
      return
    }
    if (l.type === ' ') {
      out.push(' ' + l.text)
      oldCount++
      newCount++
      lastKept = true
    } else if (l.type === '-') {
      if (sel) {
        out.push('-' + l.text)
        oldCount++
        lastKept = true
      } else if (!reverse) {
        out.push(' ' + l.text)
        oldCount++
        newCount++
        lastKept = true
      } else lastKept = false
    } else {
      if (sel) {
        out.push('+' + l.text)
        newCount++
        lastKept = true
      } else if (reverse) {
        out.push(' ' + l.text)
        oldCount++
        newCount++
        lastKept = true
      } else lastKept = false
    }
  })
  return `${file.header.join('\n')}\n@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${out.join('\n')}\n`
}

export interface SplitRow {
  left: (DiffLine & { idx: number }) | null
  right: (DiffLine & { idx: number }) | null
}

/** Pair removed/added runs side by side for the split view. */
export function toSplitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.type === ' ') {
      rows.push({ left: { ...l, idx: i }, right: { ...l, idx: i } })
      i++
    } else if (l.type === '\\') {
      i++
    } else {
      const dels: (DiffLine & { idx: number })[] = []
      const adds: (DiffLine & { idx: number })[] = []
      while (i < lines.length && (lines[i].type === '-' || lines[i].type === '\\')) {
        if (lines[i].type === '-') dels.push({ ...lines[i], idx: i })
        i++
      }
      while (i < lines.length && (lines[i].type === '+' || lines[i].type === '\\')) {
        if (lines[i].type === '+') adds.push({ ...lines[i], idx: i })
        i++
      }
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    }
  }
  return rows
}

export interface ConflictChunk {
  kind: 'text' | 'conflict'
  text?: string
  ours?: string
  theirs?: string
  base?: string
  oursLabel?: string
  theirsLabel?: string
}

/** Split a file containing <<<<<<< / ======= / >>>>>>> markers into chunks. */
export function parseConflicts(content: string): ConflictChunk[] {
  const lines = content.split('\n')
  const chunks: ConflictChunk[] = []
  let text: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('<<<<<<<')) {
      if (text.length) chunks.push({ kind: 'text', text: text.join('\n') })
      text = []
      const ours: string[] = []
      const base: string[] = []
      const theirs: string[] = []
      const oursLabel = line.slice(7).trim()
      let section: 'ours' | 'base' | 'theirs' = 'ours'
      let theirsLabel = ''
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.startsWith('|||||||') && section === 'ours') section = 'base'
        else if (l.startsWith('=======') && section !== 'theirs') section = 'theirs'
        else if (l.startsWith('>>>>>>>') && section === 'theirs') {
          theirsLabel = l.slice(7).trim()
          break
        } else (section === 'ours' ? ours : section === 'base' ? base : theirs).push(l)
        i++
      }
      chunks.push({ kind: 'conflict', ours: ours.join('\n'), theirs: theirs.join('\n'), base: base.join('\n'), oursLabel, theirsLabel })
      i++
      continue
    }
    text.push(line)
    i++
  }
  if (text.length) chunks.push({ kind: 'text', text: text.join('\n') })
  return chunks
}
