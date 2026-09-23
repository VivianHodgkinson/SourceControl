/**
 * Lane assignment for the commit graph. Commits must be in an order where
 * children come before parents (git's --date-order guarantees this).
 *
 * Each row records the lines that cross it so it can be drawn independently,
 * which lets the graph be virtualised.
 */

export interface Edge {
  lane: number
  color: number
}

export interface GraphRow {
  col: number
  color: number
  /** Lanes that pass straight through this row */
  pass: Edge[]
  /** Lines entering the node from the top, from the given lane */
  incoming: Edge[]
  /** Lines leaving the node towards the bottom, into the given lane */
  outgoing: Edge[]
  /** Lanes that move sideways through this row (top at `from`, bottom at `lane`) */
  shift: (Edge & { from: number })[]
}

export function layoutGraph(commits: { hash: string; parents: string[] }[]): { rows: GraphRow[]; width: number } {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  let width = 1

  const freeLane = (): number => {
    const i = lanes.indexOf(null)
    if (i >= 0) return i
    lanes.push(null)
    return lanes.length - 1
  }

  const rows: GraphRow[] = commits.map((c) => {
    const before = lanes.slice()
    let col = lanes.indexOf(c.hash)
    if (col < 0) {
      col = freeLane()
      lanes[col] = c.hash
      colors[col] = nextColor++
    }
    const color = colors[col]

    const incoming: Edge[] = []
    before.forEach((h, i) => {
      if (h === c.hash) {
        incoming.push({ lane: i, color: colors[i] })
        if (i !== col) lanes[i] = null
      }
    })
    let pass: Edge[] = []
    before.forEach((h, i) => {
      if (h !== null && h !== c.hash) pass.push({ lane: i, color: colors[i] })
    })

    const outgoing: Edge[] = []
    const shift: (Edge & { from: number })[] = []
    if (c.parents.length === 0) {
      lanes[col] = null
    } else {
      const [first, ...rest] = c.parents
      const existing = lanes.indexOf(first)
      if (existing >= 0 && existing < col) {
        // First parent is already drawn in a lane to the left: join it.
        outgoing.push({ lane: existing, color })
        lanes[col] = null
      } else if (existing > col) {
        // First parent is drawn further right: pull that lane in to ours so
        // the older history stays on the leftmost lane.
        lanes[col] = first
        lanes[existing] = null
        outgoing.push({ lane: col, color })
        pass = pass.filter((p) => p.lane !== existing)
        shift.push({ from: existing, lane: col, color: colors[existing] })
      } else {
        lanes[col] = first
        outgoing.push({ lane: col, color })
      }
      for (const p of rest) {
        let k = lanes.indexOf(p)
        if (k < 0) {
          k = freeLane()
          lanes[k] = p
          colors[k] = nextColor++
        }
        outgoing.push({ lane: k, color: colors[k] })
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    width = Math.max(width, before.length, lanes.length, col + 1)
    return { col, color, pass, incoming, outgoing, shift }
  })

  return { rows, width }
}
