"use client"
import { useState, useMemo } from "react"
import { usePredictionStore } from "@/store/predictionStore"
import type { PredictionItem, AnomalyItem } from "@/store/predictionStore"
import { PREDICTION_COLORS, SEVERITY_COLORS, EVENT_DOT } from "@/lib/constants"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { resolvePrediction } from "@/lib/api"
import { SectionHeader } from "@/components/ui/section-header"
import { EmptyState } from "@/components/ui/empty-state"

// ─── Confidence ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ value, color }: { value: number; color: string }) {
  const r = 9, cx = 12, cy = 12
  const circ   = 2 * Math.PI * r
  const offset = circ * (1 - value)
  const stroke = color.includes("rose") ? "#f87171"
    : color.includes("amber") ? "#fbbf24"
    : color.includes("blue") ? "#60a5fa"
    : color.includes("orange") ? "#fb923c"
    : "#71717a"
  return (
    <svg width={24} height={24} className="shrink-0 -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(63,63,70,0.4)" strokeWidth={2} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
    </svg>
  )
}

// ─── Horizon countdown bar ────────────────────────────────────────────────────

function HorizonBar({ expiresAt, horizonMinutes }: { expiresAt: string; horizonMinutes: number }) {
  const remaining = (new Date(expiresAt).getTime() - Date.now()) / 60_000
  const pct       = Math.max(0, Math.min(1, remaining / horizonMinutes))
  const color     = pct > 0.25 ? "bg-primary" : "bg-status-warning"
  return (
    <div className="w-full h-px bg-border rounded-full overflow-hidden mt-1.5">
      <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${pct * 100}%` }} />
    </div>
  )
}

// ─── Anomaly type mini-histogram ──────────────────────────────────────────────

function AnomalyHistogram({ anomalies }: { anomalies: AnomalyItem[] }) {
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of anomalies) map[a.event_type] = (map[a.event_type] ?? 0) + 1
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [anomalies])

  if (counts.length === 0) return null
  const max = counts[0][1]

  return (
    <div className="px-3 py-2 border-b border-border/40 space-y-1">
      {counts.map(([type, n]) => (
        <div key={type} className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_DOT[type] ?? "bg-zinc-500"}`} />
          <div className="flex-1 h-px bg-border rounded-full overflow-hidden">
            <div
              className={`h-full ${SEVERITY_COLORS[type]?.includes("rose") ? "bg-rose-500" : "bg-amber-400"} opacity-60`}
              style={{ width: `${(n / max) * 100}%` }}
            />
          </div>
          <span className="text-label text-muted-foreground tabular-nums w-4 text-right" data-value>{n}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Prediction card ─────────────────────────────────────────────────────────

function PredictionCard({ p }: { p: PredictionItem }) {
  const colorClass      = PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-zinc-400/30 bg-zinc-400/5"
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
    <div className="px-3 py-2.5 border-b border-border/40 animate-in fade-in duration-300">
      <div className="flex items-start gap-2 mb-1.5">
        <ConfidenceRing value={p.confidence} color={colorClass} />
        <div className="flex-1 min-w-0">
          <span className={`text-label px-1.5 py-0.5 rounded border ${colorClass}`}>
            {p.prediction_type.replace(/_/g, " ")}
          </span>
          <span className="text-caption text-muted-foreground tabular-nums ml-2" data-value>
            {(p.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      <p className="text-detail text-foreground/80 leading-relaxed">{p.narrative}</p>
      {p.involved_fish.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {p.involved_fish.map((f) => (
            <span key={f.fish_id} className="text-label text-muted-foreground border border-border rounded px-1 py-0.5">
              {f.fish_name}
            </span>
          ))}
        </div>
      )}
      <HorizonBar expiresAt={p.expires_at} horizonMinutes={p.horizon_minutes} />
      <p className="text-label text-muted-foreground mt-1.5">
        expires {formatDistanceToNow(p.expires_at)} · {p.horizon_minutes}min
      </p>
      <div className="flex gap-1.5 mt-1.5">
        <button
          disabled={resolving}
          onClick={() => resolve("resolved_correct")}
          className="text-label px-1.5 py-0.5 rounded border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40"
        >
          correct
        </button>
        <button
          disabled={resolving}
          onClick={() => resolve("resolved_incorrect")}
          className="text-label px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:border-rose-400/30 hover:text-rose-400 transition-colors disabled:opacity-40"
        >
          incorrect
        </button>
      </div>
    </div>
  )
}

// ─── Anomaly card ─────────────────────────────────────────────────────────────

function AnomalyCard({ a }: { a: AnomalyItem }) {
  const colorClass  = SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.low
  const borderColor = a.severity === "high" ? "border-l-rose-500"
    : a.severity === "medium" ? "border-l-amber-400"
    : "border-l-border"
  return (
    <div className={`pl-2.5 pr-3 py-2 border-b border-border/40 border-l-2 ${borderColor} animate-in fade-in duration-300`}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className={`text-label px-1.5 py-0.5 rounded border ${colorClass}`}>
          {a.event_type.replace(/_/g, " ")}
        </span>
        <span className={`text-label ${colorClass.split(" ")[0]}`}>{a.severity}</span>
      </div>
      {a.involved_fish.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-0.5">
          {a.involved_fish.map((f) => (
            <span key={f.fish_id} className="text-label text-muted-foreground">{f.fish_name}</span>
          ))}
        </div>
      )}
      <p className="text-label text-muted-foreground mt-0.5">{formatDistanceToNow(a.started_at)} ago</p>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function RightPanel() {
  const allPredictions = usePredictionStore((s) => s.predictions)
  const anomalies      = usePredictionStore((s) => s.anomalies)
  const predictions    = allPredictions.filter((p) => p.status === "active")
  const [showAllAnomalies, setShowAllAnomalies] = useState(false)
  const visibleAnomalies = showAllAnomalies ? anomalies : anomalies.slice(0, 3)

  // Last anomaly time
  const lastAnomalyLabel = anomalies.length > 0
    ? formatDistanceToNow(anomalies[0].started_at) + " ago"
    : null

  return (
    <aside className="w-52 shrink-0 flex flex-col border-l border-border/40 bg-background/75 backdrop-blur-md overflow-hidden pointer-events-auto">
      {/* Predictions */}
      <SectionHeader
        label="Predictions"
        count={predictions.length}
        countColor="text-rose-400"
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {predictions.length === 0
          ? <EmptyState message="no active predictions" />
          : predictions.map((p) => <PredictionCard key={p.uuid} p={p} />)
        }
      </div>

      {/* Anomalies */}
      <div className="border-t border-border/40 shrink-0 flex flex-col max-h-64">
        <SectionHeader
          label="Anomalies"
          count={anomalies.length}
          countColor="text-amber-400"
          right={
            <div className="flex items-center gap-2">
              {lastAnomalyLabel && (
                <span className="text-label text-muted-foreground">{lastAnomalyLabel}</span>
              )}
              {anomalies.length > 0 && (
                <span className="text-label text-amber-400">{anomalies.length}</span>
              )}
            </div>
          }
        />
        {anomalies.length > 0 && <AnomalyHistogram anomalies={anomalies} />}
        <div className="overflow-y-auto scrollbar-thin">
          {anomalies.length === 0
            ? <EmptyState message="no anomalies" height="sm" />
            : visibleAnomalies.map((a) => <AnomalyCard key={a.uuid} a={a} />)
          }
          {!showAllAnomalies && anomalies.length > 3 && (
            <button
              onClick={() => setShowAllAnomalies(true)}
              className="w-full text-label text-muted-foreground hover:text-foreground py-2 border-t border-border/40 transition-colors"
            >
              show {anomalies.length - 3} more
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
