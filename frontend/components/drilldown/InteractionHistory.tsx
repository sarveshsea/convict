"use client"
import type { BehaviorEvent } from "@/lib/api"
import { SEVERITY_COLORS } from "@/lib/constants"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { EmptyState } from "@/components/ui/empty-state"

type RelEdge = {
  fish_a_id: string; fish_b_id: string
  weight: number; dominant_type: string
  harassment_count: number; proximity_count: number; schooling_count: number
}

interface Props {
  events: BehaviorEvent[]
  fishUuid: string
  fishName: string
  // Relationship data passed down from parent — avoids a redundant API call
  edges: RelEdge[]
  nodeNames: Record<string, string>
}

const TYPE_COLOR: Record<string, string> = {
  harassment: "text-rose-400 border-rose-400/40 bg-rose-500/10",
  proximity:  "text-zinc-400 border-zinc-500/40 bg-zinc-500/10",
  schooling:  "text-emerald-400 border-emerald-400/40 bg-emerald-500/10",
  avoidance:  "text-amber-400 border-amber-400/40 bg-amber-400/10",
}
const TYPE_BAR: Record<string, string> = {
  harassment: "bg-rose-400",
  proximity:  "bg-zinc-500",
  schooling:  "bg-emerald-400",
  avoidance:  "bg-amber-400",
}

export function InteractionHistory({ events, fishUuid, fishName, edges, nodeNames }: Props) {
  // ── Interaction edge summary ─────────────────────────────────────────
  const hasEdges = edges.length > 0
  const maxWeight = Math.max(...edges.map((e) => e.weight), 1)

  // ── Behavior-event partner counts (from old anomaly events) ─────────
  const partnerCounts: Record<string, { name: string; count: number }> = {}
  for (const e of events) {
    if (e.involved_fish.length > 1) {
      for (const f of e.involved_fish) {
        if (!partnerCounts[f.fish_id]) partnerCounts[f.fish_id] = { name: f.fish_name, count: 0 }
        partnerCounts[f.fish_id].count++
      }
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Relationship edges (new persistent data) ─────────────────── */}
      <div className="space-y-2">
        <p className="text-label text-muted-foreground">Interaction Edges — last 7 days</p>
        {!hasEdges ? (
          <p className="text-caption text-muted-foreground italic">no persistent interactions recorded yet</p>
        ) : (
          <div className="space-y-1.5">
            {edges.map((e, i) => {
              const partnerId   = e.fish_a_id === fishUuid ? e.fish_b_id : e.fish_a_id
              const partnerName = nodeNames[partnerId] ?? "Unknown"
              const cls  = TYPE_COLOR[e.dominant_type] ?? "text-zinc-400 border-border"
              const bar  = TYPE_BAR[e.dominant_type]   ?? "bg-zinc-500"
              const pct  = Math.round((e.weight / maxWeight) * 100)

              const breakdown = [
                e.harassment_count > 0 && `${e.harassment_count} harassment`,
                e.proximity_count  > 0 && `${e.proximity_count} close`,
                e.schooling_count  > 0 && `${e.schooling_count} school`,
              ].filter(Boolean).join(" · ")

              return (
                <div key={i} className="rounded border border-border/40 bg-card px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-caption font-medium text-foreground truncate">{partnerName}</span>
                      {breakdown && (
                        <span className="text-label text-muted-foreground hidden sm:block">{breakdown}</span>
                      )}
                    </div>
                    <span className={`text-label px-1.5 py-0.5 rounded border shrink-0 ${cls}`}>
                      {e.dominant_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-label text-muted-foreground tabular-nums w-6 text-right">{e.weight}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Event breakdown bar chart ─────────────────────────────────── */}
      {events.length > 0 && (() => {
        const typeCounts: Record<string, number> = {}
        for (const e of events) typeCounts[e.event_type] = (typeCounts[e.event_type] ?? 0) + 1
        const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
        const max = entries[0]?.[1] ?? 1
        return (
          <div className="space-y-1.5">
            <p className="text-label text-muted-foreground">Anomaly Event Breakdown</p>
            {entries.map(([type, n]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-caption text-muted-foreground w-24 truncate shrink-0">{type.replace(/_/g, " ")}</span>
                <div className="flex-1 h-px bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60" style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <span className="text-label text-muted-foreground w-4 text-right shrink-0 tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── Full anomaly event log ────────────────────────────────────── */}
      {events.length > 0 && (
        <div className="space-y-1">
          <p className="text-label text-muted-foreground">Anomaly Event Log</p>
          {events.map((e) => (
            <div key={e.uuid} className="px-3 py-2 rounded bg-card border border-border/30 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-label px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[e.severity] ?? "text-zinc-400 border-border"}`}>
                  {e.event_type.replace(/_/g, " ")}
                </span>
                <span className="text-label text-muted-foreground">
                  {formatDistanceToNow(e.occurred_at)} ago
                </span>
              </div>
              {e.involved_fish.length > 1 && (
                <div className="flex gap-1 flex-wrap pt-0.5">
                  {e.involved_fish.map((f) => (
                    <span key={f.fish_id} className="text-label text-muted-foreground border border-border/40 rounded px-1">
                      {f.fish_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {events.length === 0 && !hasEdges && (
        <EmptyState message="no interactions recorded yet" height="lg" />
      )}
    </div>
  )
}
