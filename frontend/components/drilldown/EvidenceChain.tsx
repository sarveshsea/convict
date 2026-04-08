"use client"
import { useEffect, useState } from "react"
import { listPredictions, listEvents } from "@/lib/api"
import type { PredictionItem, BehaviorEvent } from "@/lib/api"
import { PREDICTION_COLORS } from "@/lib/constants"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { EmptyState } from "@/components/ui/empty-state"

interface Props { fishUuid: string; fishName: string }

export function EvidenceChain({ fishUuid, fishName }: Props) {
  const [predictions, setPredictions] = useState<PredictionItem[]>([])
  const [events, setEvents]           = useState<BehaviorEvent[]>([])
  const [loading, setLoading]         = useState(true)

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
    return <div className="text-caption text-muted-foreground py-4">loading…</div>
  }

  if (predictions.length === 0 && events.length === 0) {
    return <EmptyState message={`no active predictions or events for ${fishName}`} height="lg" />
  }

  return (
    <div className="space-y-4">
      {predictions.length > 0 && (
        <div className="space-y-2">
          <p className="text-label text-muted-foreground">Active Predictions</p>
          {predictions.map((p) => {
            const colorClass = PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-zinc-400/30 bg-zinc-400/5"
            return (
              <div key={p.uuid} className="px-3 py-2.5 rounded border border-border/40 bg-card space-y-1">
                <span className={`text-label px-1.5 py-0.5 rounded border ${colorClass}`}>
                  {p.prediction_type.replace(/_/g, " ")}
                </span>
                <p className="text-detail text-foreground/80 leading-relaxed">{p.narrative}</p>
                <p className="text-label text-muted-foreground" data-value>
                  {(p.confidence * 100).toFixed(0)}% confidence · expires {formatDistanceToNow(p.expires_at)}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label text-muted-foreground">Contributing Events</p>
          {events.map((e) => (
            <div key={e.uuid} className="flex items-center justify-between px-3 py-1.5 rounded border border-border/30 bg-card">
              <span className="text-caption text-foreground/70">
                {e.event_type.replace(/_/g, " ")}
              </span>
              <span className="text-label text-muted-foreground">
                {formatDistanceToNow(e.occurred_at)} ago
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
