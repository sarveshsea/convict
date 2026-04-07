"use client"
import { useEffect, useState } from "react"
import { listPredictions, listEvents } from "@/lib/api"
import type { PredictionItem, BehaviorEvent } from "@/lib/api"
import { formatDistanceToNow } from "@/lib/timeUtils"

const PRED_COLOR: Record<string, string> = {
  aggression_escalation: "text-rose-400 border-rose-400/30 bg-rose-400/5",
  isolation_trend:       "text-amber-400 border-amber-400/30 bg-amber-400/5",
  territory_shift:       "text-blue-400 border-blue-400/30 bg-blue-400/5",
  schooling_break:       "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
  feeding_disruption:    "text-orange-400 border-orange-400/30 bg-orange-400/5",
}

interface Props { fishUuid: string; fishName: string }

export function EvidenceChain({ fishUuid, fishName }: Props) {
  const [predictions, setPredictions] = useState<PredictionItem[]>([])
  const [events, setEvents] = useState<BehaviorEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [preds, evts] = await Promise.all([
          listPredictions("active"),
          listEvents(20),
        ])
        setPredictions(preds.filter((p) => p.involved_fish.some((f) => f.fish_id === fishUuid)))
        setEvents(evts.filter((e) => e.involved_fish.some((f) => f.fish_id === fishUuid)))
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [fishUuid])

  if (loading) {
    return <div className="text-[10px] font-mono text-muted-foreground py-4">loading…</div>
  }

  if (predictions.length === 0 && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[10px] font-mono text-muted-foreground">
        no active predictions or events for {fishName}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {predictions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            Active Predictions
          </p>
          {predictions.map((p) => {
            const colorClass = PRED_COLOR[p.prediction_type] ?? "text-zinc-400 border-zinc-400/30"
            return (
              <div key={p.uuid} className="px-3 py-2.5 rounded border border-border/40 bg-surface space-y-1">
                <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${colorClass}`}>
                  {p.prediction_type.replace(/_/g, " ")}
                </span>
                <p className="text-[11px] text-foreground/80 leading-relaxed">{p.narrative}</p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {(p.confidence * 100).toFixed(0)}% confidence · expires {formatDistanceToNow(p.expires_at)}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            Contributing Events
          </p>
          {events.map((e) => (
            <div key={e.uuid} className="flex items-center justify-between px-3 py-1.5 rounded border border-border/30 bg-surface">
              <span className="text-[10px] font-mono text-foreground/70">
                {e.event_type.replace(/_/g, " ")}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {formatDistanceToNow(e.occurred_at)} ago
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
