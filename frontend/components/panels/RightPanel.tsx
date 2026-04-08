"use client"
import { useEffect, useState } from "react"
import { usePredictionStore } from "@/store/predictionStore"
import { useUIStore } from "@/store/uiStore"
import type { PredictionItem, AnomalyItem } from "@/store/predictionStore"
import { PREDICTION_COLORS, SEVERITY_COLORS } from "@/lib/constants"
import { formatDistanceToNow } from "@/lib/timeUtils"
import { resolvePrediction } from "@/lib/api"
import { SectionHeader } from "@/components/ui/section-header"
import { EmptyState } from "@/components/ui/empty-state"

// ─── Confidence ring ──────────────────────────────────────────────────────────

const RING_STROKE: Record<string, string> = {
  aggression_escalation: "#f87171",
  isolation_trend:       "#fbbf24",
  territory_shift:       "#60a5fa",
  schooling_break:       "#a1a1aa",
  feeding_disruption:    "#fb923c",
}

function ConfidenceRing({ value, type }: { value: number; type: string }) {
  const r = 9, cx = 12, cy = 12
  const circ   = 2 * Math.PI * r
  const offset = circ * (1 - value)
  const stroke = RING_STROKE[type] ?? "#71717a"
  return (
    <svg width={24} height={24} className="shrink-0 -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(63,63,70,0.4)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={2}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
    </svg>
  )
}

// ─── Horizon countdown bar ────────────────────────────────────────────────────

function HorizonBar({ expiresAt, horizonMinutes }: { expiresAt: string; horizonMinutes: number }) {
  const [pct, setPct] = useState(() => {
    const rem = (new Date(expiresAt).getTime() - Date.now()) / 60_000
    return Math.max(0, Math.min(1, rem / horizonMinutes))
  })
  useEffect(() => {
    const id = setInterval(() => {
      const rem = (new Date(expiresAt).getTime() - Date.now()) / 60_000
      setPct(Math.max(0, Math.min(1, rem / horizonMinutes)))
    }, 10_000)
    return () => clearInterval(id)
  }, [expiresAt, horizonMinutes])
  return (
    <div className="w-full h-px bg-border rounded-full overflow-hidden mt-1.5">
      <div className={`h-full transition-all duration-1000 ${pct > 0.25 ? "bg-primary" : "bg-status-warning"}`}
        style={{ width: `${pct * 100}%` }} />
    </div>
  )
}

// ─── Prediction card ──────────────────────────────────────────────────────────

function PredictionCard({ p }: { p: PredictionItem }) {
  const colorClass       = PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-zinc-400/30 bg-zinc-400/5"
  const upsertPrediction = usePredictionStore((s) => s.upsertPrediction)
  const { openFishModal } = useUIStore()
  const [resolving, setResolving] = useState(false)
  const [expanded,  setExpanded]  = useState(false)

  async function resolve(outcome: "resolved_correct" | "resolved_incorrect") {
    setResolving(true)
    try { await resolvePrediction(p.uuid, outcome); upsertPrediction({ ...p, status: outcome }) }
    catch {}
    finally { setResolving(false) }
  }

  return (
    <div className="px-3 py-2 border-b border-border/40 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 mb-1">
        <ConfidenceRing value={p.confidence} type={p.prediction_type} />
        <span className={`text-label px-1.5 py-0.5 rounded border flex-1 min-w-0 truncate ${colorClass}`}>
          {p.prediction_type.replace(/_/g, " ")}
        </span>
        <span className="text-label text-muted-foreground tabular-nums shrink-0" data-value>
          {(p.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <p className="text-caption text-foreground/75 leading-relaxed">{p.narrative}</p>

      {p.involved_fish.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {p.involved_fish.map((f) => (
            <button key={f.fish_id} onClick={() => openFishModal(f.fish_id)}
              className="text-label text-muted-foreground border border-border/40 rounded px-1 py-0.5 hover:text-foreground hover:border-border transition-colors">
              {f.fish_name}
            </button>
          ))}
        </div>
      )}

      <HorizonBar expiresAt={p.expires_at} horizonMinutes={p.horizon_minutes} />
      <p className="text-label text-muted-foreground mt-1">
        expires {formatDistanceToNow(p.expires_at)} · {p.horizon_minutes}min
      </p>

      {/* Resolve buttons — shown on demand */}
      <div className="mt-1.5">
        {!expanded
          ? <button onClick={() => setExpanded(true)} className="text-label text-muted-foreground/50 hover:text-muted-foreground transition-colors">resolve…</button>
          : (
            <div className="flex gap-1.5">
              <button disabled={resolving} onClick={() => resolve("resolved_correct")}
                className="text-label px-1.5 py-0.5 rounded border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40">
                correct
              </button>
              <button disabled={resolving} onClick={() => resolve("resolved_incorrect")}
                className="text-label px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:border-rose-400/30 hover:text-rose-400 transition-colors disabled:opacity-40">
                incorrect
              </button>
            </div>
          )
        }
      </div>
    </div>
  )
}

// ─── Anomaly card ─────────────────────────────────────────────────────────────

function AnomalyCard({ a, onDismiss }: { a: AnomalyItem; onDismiss: (uuid: string) => void }) {
  const colorClass  = SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.low
  const borderColor = a.severity === "high" ? "border-l-status-critical"
    : a.severity === "medium" ? "border-l-status-warning"
    : "border-l-border"
  const { openFishModal } = useUIStore()

  return (
    <div className={`pl-2.5 pr-3 py-2 border-b border-border/40 border-l-2 ${borderColor} animate-in fade-in duration-300 group`}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className={`text-label px-1.5 py-0.5 rounded border ${colorClass} truncate`}>
          {a.event_type.replace(/_/g, " ")}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-label text-muted-foreground">{formatDistanceToNow(a.started_at)} ago</span>
          <button onClick={() => onDismiss(a.uuid)}
            className="text-label text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:!text-foreground transition-colors leading-none">
            ×
          </button>
        </div>
      </div>
      {a.involved_fish.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {a.involved_fish.map((f) => (
            <button key={f.fish_id} onClick={() => openFishModal(f.fish_id)}
              className="text-label text-muted-foreground hover:text-foreground transition-colors">
              {f.fish_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── All-clear state ──────────────────────────────────────────────────────────

function AllClear() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/50">
      <div className="w-8 h-8 rounded-full border border-emerald-400/20 flex items-center justify-center">
        <span className="text-emerald-400/60 text-caption">✓</span>
      </div>
      <span className="text-label">all clear</span>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function RightPanel() {
  const allPredictions   = usePredictionStore((s) => s.predictions)
  const allAnomalies     = usePredictionStore((s) => s.anomalies)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [showAllPreds,  setShowAllPreds]  = useState(false)
  const [showAllAnomalies, setShowAllAnomalies] = useState(false)

  const predictions = allPredictions.filter((p) => p.status === "active")
  const anomalies   = allAnomalies.filter((a) => !dismissed.has(a.uuid))
  const allClear    = predictions.length === 0 && anomalies.length === 0

  const visiblePreds     = showAllPreds     ? predictions : predictions.slice(0, 3)
  const visibleAnomalies = showAllAnomalies ? anomalies   : anomalies.slice(0, 3)

  function dismiss(uuid: string) {
    setDismissed((prev) => new Set([...prev, uuid]))
  }

  return (
    <aside className="w-52 shrink-0 flex flex-col border-l border-border/40 bg-background/80 backdrop-blur-md overflow-hidden pointer-events-auto">

      {allClear ? <AllClear /> : (
        <>
          {/* Predictions */}
          <SectionHeader label="Predictions" count={predictions.length} countColor="text-rose-400" />
          <div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: "50%" }}>
            {predictions.length === 0
              ? <EmptyState message="none active" height="sm" />
              : <>
                  {visiblePreds.map((p) => <PredictionCard key={p.uuid} p={p} />)}
                  {!showAllPreds && predictions.length > 3 && (
                    <button onClick={() => setShowAllPreds(true)}
                      className="w-full text-label text-muted-foreground hover:text-foreground py-2 border-t border-border/40 transition-colors">
                      {predictions.length - 3} more
                    </button>
                  )}
                </>
            }
          </div>

          {/* Anomalies */}
          <SectionHeader label="Anomalies" count={anomalies.length} countColor="text-amber-400" />
          <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
            {anomalies.length === 0
              ? <EmptyState message="none flagged" height="sm" />
              : <>
                  {visibleAnomalies.map((a) => <AnomalyCard key={a.uuid} a={a} onDismiss={dismiss} />)}
                  {!showAllAnomalies && anomalies.length > 3 && (
                    <button onClick={() => setShowAllAnomalies(true)}
                      className="w-full text-label text-muted-foreground hover:text-foreground py-2 border-t border-border/40 transition-colors">
                      {anomalies.length - 3} more
                    </button>
                  )}
                </>
            }
          </div>
        </>
      )}
    </aside>
  )
}
