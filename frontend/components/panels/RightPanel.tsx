"use client"
import { useState } from "react"
import { usePredictionStore } from "@/store/predictionStore"
import type { PredictionItem, AnomalyItem } from "@/store/predictionStore"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { resolvePrediction } from "@/lib/api"

const PREDICTION_COLORS: Record<string, string> = {
  aggression_escalation: "text-rose-400 border-rose-400/30 bg-rose-400/5",
  isolation_trend: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  territory_shift: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  schooling_break: "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
  feeding_disruption: "text-orange-400 border-orange-400/30 bg-orange-400/5",
}

const SEVERITY_COLORS = {
  high: "text-rose-400 border-rose-400/30 bg-rose-400/5",
  medium: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  low: "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
}

function PredictionCard({ p }: { p: PredictionItem }) {
  const colorClass = PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-zinc-400/30"
  const upsertPrediction = usePredictionStore((s) => s.upsertPrediction)
  const [resolving, setResolving] = useState(false)

  async function resolve(outcome: "resolved_correct" | "resolved_incorrect") {
    setResolving(true)
    try {
      await resolvePrediction(p.uuid, outcome)
      upsertPrediction({ ...p, status: outcome })
    } catch {}
    finally { setResolving(false) }
  }

  return (
    <div className="px-3 py-2.5 border-b border-border/40">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border ${colorClass}`}>
          {p.prediction_type.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {(p.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{p.narrative}</p>
      {p.involved_fish.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {p.involved_fish.map((f) => (
            <span key={f.fish_id} className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1 py-0.5">
              {f.fish_name}
            </span>
          ))}
        </div>
      )}
      <p className="text-[9px] font-mono text-muted-foreground mt-1">
        expires {formatDistanceToNow(p.expires_at)} · {p.horizon_minutes}min horizon
      </p>
      <div className="flex gap-1.5 mt-1.5">
        <button
          disabled={resolving}
          onClick={() => resolve("resolved_correct")}
          className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40"
        >
          correct
        </button>
        <button
          disabled={resolving}
          onClick={() => resolve("resolved_incorrect")}
          className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-zinc-600 text-muted-foreground hover:border-rose-400/30 hover:text-rose-400 transition-colors disabled:opacity-40"
        >
          incorrect
        </button>
      </div>
    </div>
  )
}

function AnomalyCard({ a }: { a: AnomalyItem }) {
  const colorClass = SEVERITY_COLORS[a.severity]
  return (
    <div className="px-3 py-2 border-b border-border/40">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${colorClass}`}>
          {a.event_type.replace(/_/g, " ")}
        </span>
        <span className={`text-[9px] font-mono uppercase ${colorClass.split(" ")[0]}`}>{a.severity}</span>
      </div>
      {a.involved_fish.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {a.involved_fish.map((f) => (
            <span key={f.fish_id} className="text-[9px] font-mono text-muted-foreground">{f.fish_name}</span>
          ))}
        </div>
      )}
      <p className="text-[9px] font-mono text-muted-foreground">{formatDistanceToNow(a.started_at)} ago</p>
    </div>
  )
}

export function RightPanel() {
  const allPredictions = usePredictionStore((s) => s.predictions)
  const anomalies = usePredictionStore((s) => s.anomalies)
  const predictions = allPredictions.filter((p) => p.status === "active")

  return (
    <aside className="w-48 shrink-0 flex flex-col border-l border-zinc-800/60 bg-zinc-950/75 backdrop-blur-md overflow-hidden pointer-events-auto">
      {/* Predictions section */}
      <div className="px-3 py-2 border-b border-zinc-800/60 shrink-0">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Predictions</span>
        {predictions.length > 0 && (
          <span className="float-right text-[9px] font-mono text-rose-400">{predictions.length}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {predictions.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[10px] font-mono text-muted-foreground">
            No active predictions
          </div>
        ) : (
          predictions.map((p) => <PredictionCard key={p.uuid} p={p} />)
        )}
      </div>

      {/* Anomaly queue */}
      <div className="border-t border-zinc-800/60 shrink-0">
        <div className="px-3 py-2 border-b border-zinc-800/40">
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Anomalies</span>
          {anomalies.length > 0 && (
            <span className="float-right text-[9px] font-mono text-amber-400">{anomalies.length}</span>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto scrollbar-thin">
          {anomalies.length === 0 ? (
            <div className="flex items-center justify-center h-12 text-[10px] font-mono text-muted-foreground">
              No anomalies
            </div>
          ) : (
            anomalies.slice(0, 10).map((a) => <AnomalyCard key={a.uuid} a={a} />)
          )}
        </div>
      </div>
    </aside>
  )
}
