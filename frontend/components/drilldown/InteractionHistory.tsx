"use client"
import type { BehaviorEvent } from "@/lib/api"
import { SEVERITY_COLORS } from "@/lib/constants"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { EmptyState } from "@/components/ui/empty-state"

interface Props { events: BehaviorEvent[] }

export function InteractionHistory({ events }: Props) {
  if (events.length === 0) {
    return <EmptyState message="no events recorded yet" height="lg" />
  }

  // Derive interaction partners from harassment/chase events
  const partnerCounts: Record<string, { name: string; count: number }> = {}
  for (const e of events) {
    if (e.involved_fish.length > 1) {
      for (const f of e.involved_fish) {
        if (!partnerCounts[f.fish_id]) partnerCounts[f.fish_id] = { name: f.fish_name, count: 0 }
        partnerCounts[f.fish_id].count++
      }
    }
  }
  const partners = Object.values(partnerCounts).sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-4">
      {/* Interaction partners */}
      {partners.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label text-muted-foreground">Interaction Partners</p>
          {partners.map((p) => (
            <div key={p.name} className="flex items-center gap-2 px-3 py-1.5 rounded border border-border/30 bg-card">
              <span className="text-caption text-foreground flex-1">{p.name}</span>
              <span className="text-label text-muted-foreground" data-value>{p.count} events</span>
            </div>
          ))}
        </div>
      )}

      {/* Event breakdown bar chart */}
      {(() => {
        const typeCounts: Record<string, number> = {}
        for (const e of events) typeCounts[e.event_type] = (typeCounts[e.event_type] ?? 0) + 1
        const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
        const max = entries[0]?.[1] ?? 1
        return entries.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-label text-muted-foreground">Event Breakdown</p>
            {entries.map(([type, n]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-caption text-muted-foreground w-24 truncate shrink-0">{type.replace(/_/g, " ")}</span>
                <div className="flex-1 h-px bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary opacity-60" style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <span className="text-label text-muted-foreground w-4 text-right shrink-0" data-value>{n}</span>
              </div>
            ))}
          </div>
        ) : null
      })()}

      {/* Full event log */}
      <div className="space-y-1">
        <p className="text-label text-muted-foreground">Event Log</p>
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
    </div>
  )
}
