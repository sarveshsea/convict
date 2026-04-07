"use client"
import type { BehaviorEvent } from "@/lib/api"
import { formatDistanceToNow } from "@/lib/timeUtils"

const SEVERITY_COLOR = {
  high:   "text-rose-400 border-rose-400/30 bg-rose-400/5",
  medium: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  low:    "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
}

interface Props { events: BehaviorEvent[] }

export function InteractionHistory({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[10px] font-mono text-muted-foreground">
        no events recorded yet
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
        Interaction History
      </p>
      {events.map((e) => (
        <div key={e.uuid} className="px-3 py-2 rounded bg-surface border border-border/30 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${SEVERITY_COLOR[e.severity]}`}>
              {e.event_type.replace(/_/g, " ")}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">
              {formatDistanceToNow(e.occurred_at)} ago
            </span>
          </div>
          {e.involved_fish.length > 1 && (
            <div className="flex gap-1 flex-wrap pt-0.5">
              {e.involved_fish.map((f) => (
                <span key={f.fish_id} className="text-[9px] font-mono text-muted-foreground border border-border/40 rounded px-1">
                  {f.fish_name}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
