"use client"
import { useEffect, useMemo, useState } from "react"
import { getBehaviorTransitions, type BehaviorTransitionsResponse } from "@/lib/api"
import { SectionHeader } from "@/components/ui/section-header"

function bgFor(intensity: number): string {
  // intensity in [0,1]; map to discrete primary shades
  if (intensity <= 0)    return ""
  if (intensity < 0.15)  return "bg-primary/10"
  if (intensity < 0.30)  return "bg-primary/20"
  if (intensity < 0.45)  return "bg-primary/30"
  if (intensity < 0.60)  return "bg-primary/40"
  if (intensity < 0.75)  return "bg-primary/60"
  return "bg-primary/80"
}

function shortLabel(s: string): string {
  return s.replace(/_/g, " ")
}

export function TransitionMatrix() {
  const [data, setData]   = useState<BehaviorTransitionsResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = () => {
      getBehaviorTransitions(168)
        .then((r) => { if (!cancelled) { setData(r); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    fetchOnce()
    const id = setInterval(fetchOnce, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Build cell lookup: source -> target -> {count, gap}
  const { types, lookup, total, top, maxCount } = useMemo(() => {
    if (!data || data.edges.length === 0) {
      return { types: [] as string[], lookup: new Map<string, Map<string, { count: number; gap: number }>>(), total: 0, top: null as null | { source: string; target: string; count: number }, maxCount: 0 }
    }
    const types = data.nodes.map((n) => n.id)
    const lookup = new Map<string, Map<string, { count: number; gap: number }>>()
    let total = 0
    let max = 0
    let top: { source: string; target: string; count: number } | null = null
    for (const e of data.edges) {
      if (!lookup.has(e.source)) lookup.set(e.source, new Map())
      lookup.get(e.source)!.set(e.target, { count: e.count, gap: e.avg_gap_minutes })
      total += e.count
      if (e.count > max) max = e.count
      if (!top || e.count > top.count) top = { source: e.source, target: e.target, count: e.count }
    }
    return { types, lookup, total, top, maxCount: max }
  }, [data])

  if (error && !data) {
    return (
      <div>
        <SectionHeader label="Behavior Transitions" countColor="text-muted-foreground" />
        <p className="px-3 py-2 text-caption text-muted-foreground/70">unavailable</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <SectionHeader label="Behavior Transitions" countColor="text-muted-foreground" />
        <p className="px-3 py-2 text-caption text-muted-foreground/70">loading…</p>
      </div>
    )
  }

  if (types.length === 0 || total === 0) {
    return (
      <div>
        <SectionHeader label="Behavior Transitions" countColor="text-muted-foreground" />
        <p className="px-3 py-2 text-caption text-muted-foreground/70">no transitions in window</p>
      </div>
    )
  }

  const days = (data.window_hours / 24).toFixed(0)

  return (
    <div>
      <SectionHeader label="Behavior Transitions" right={
        <span className="text-label text-muted-foreground tabular-nums" data-value>{days}d window</span>
      } />
      <div className="px-3 py-2 overflow-x-auto scrollbar-thin">
        <table className="text-label tabular-nums border-collapse">
          <thead>
            <tr>
              <th className="p-1"></th>
              {types.map((t) => (
                <th key={t} className="p-1 text-left font-normal text-muted-foreground/70 align-bottom">
                  <div className="origin-bottom-left -rotate-45 whitespace-nowrap translate-y-1">{shortLabel(t)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((src) => (
              <tr key={src}>
                <td className="p-1 pr-2 text-muted-foreground/70 whitespace-nowrap text-right">{shortLabel(src)}</td>
                {types.map((tgt) => {
                  if (src === tgt) {
                    return (
                      <td key={tgt} className="p-0 border border-border/30">
                        <div className="w-7 h-6 flex items-center justify-center text-muted-foreground/30">–</div>
                      </td>
                    )
                  }
                  const cell = lookup.get(src)?.get(tgt)
                  const count = cell?.count ?? 0
                  const intensity = maxCount > 0 ? count / maxCount : 0
                  const bg = bgFor(intensity)
                  const tip = count > 0
                    ? `${shortLabel(src)} → ${shortLabel(tgt)}: ${count} transitions, avg gap ${cell!.gap.toFixed(1)} min`
                    : `${shortLabel(src)} → ${shortLabel(tgt)}: 0`
                  return (
                    <td key={tgt} className="p-0 border border-border/30">
                      <div
                        title={tip}
                        className={`w-7 h-6 flex items-center justify-center ${bg} ${count > 0 ? "text-foreground" : "text-muted-foreground/40"}`}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 pb-3 space-y-0.5">
        <p className="text-label text-muted-foreground tabular-nums">
          <span data-value>{total}</span> total transitions
        </p>
        {top && (
          <p className="text-label text-muted-foreground/70">
            most common: <span className="text-foreground">{shortLabel(top.source)} → {shortLabel(top.target)}</span> (<span data-value>{top.count}</span>)
          </p>
        )}
      </div>
    </div>
  )
}
