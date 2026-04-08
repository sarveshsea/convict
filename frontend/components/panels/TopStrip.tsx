"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"
import { startPipeline, stopPipeline } from "@/lib/api"

// ─── Dot ─────────────────────────────────────────────────────────────────────

function Dot({ color }: { color: "healthy" | "warning" | "critical" | "off" }) {
  const cls = {
    healthy:  "bg-status-healthy",
    warning:  "bg-status-warning",
    critical: "bg-status-critical animate-pulse",
    off:      "bg-status-unknown",
  }[color]
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />
}

// ─── FPS sparkline ────────────────────────────────────────────────────────────

function FpsSparkline({ fps }: { fps: number }) {
  const history = useRef<number[]>([])
  const [path, setPath] = useState("")
  useEffect(() => {
    history.current = [...history.current.slice(-19), fps]
    const vals = history.current
    if (vals.length < 2) return
    const max = Math.max(...vals, 1)
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * 40
      const y = 14 - (v / max) * 14
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    setPath(`M ${pts.join(" L ")}`)
  }, [fps])
  const color = fps >= 10 ? "#34d399" : fps >= 5 ? "#fbbf24" : "#f87171"
  return (
    <svg width={40} height={14} className="overflow-visible shrink-0">
      {path && <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.85" />}
    </svg>
  )
}

// ─── ID ratio bar ─────────────────────────────────────────────────────────────

function IdRatioBar({ identified, total }: { identified: number; total: number }) {
  const pct = total > 0 ? identified / total : 0
  return (
    <div className="flex items-center gap-1.5" title={`${identified} of ${total} entities identified`}>
      <div className="w-10 h-px bg-border rounded-full overflow-hidden">
        <div className="h-full bg-status-healthy transition-all duration-300" style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-label text-foreground tabular-nums" data-value>{identified}/{total}</span>
    </div>
  )
}

// ─── Arc gauge ────────────────────────────────────────────────────────────────

function ArcGauge({ value }: { value: number }) {
  const r = 13, cx = 16, cy = 16
  const startAngle = Math.PI
  const sweep      = Math.PI * value
  const endAngle   = startAngle + sweep
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const large = sweep > Math.PI ? 1 : 0
  const color = value >= 0.7 ? "#34d399" : value >= 0.4 ? "#fbbf24" : "#f87171"
  return (
    <svg width={32} height={18} className="overflow-visible shrink-0">
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(63,63,70,0.5)" strokeWidth="2" strokeLinecap="round" />
      {value > 0 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  )
}

// ─── Uptime (uses real pipelineStartedAt from store) ─────────────────────────

function Uptime({ startedAt }: { startedAt: string | null }) {
  const [label, setLabel] = useState("")
  useEffect(() => {
    if (!startedAt) { setLabel(""); return }
    const tick = () => {
      const s   = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const h   = Math.floor(s / 3600)
      const m   = Math.floor((s % 3600) / 60)
      const sec = s % 60
      setLabel(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!label) return null
  return <span className="text-label text-muted-foreground tabular-nums leading-none" data-value>{label}</span>
}

// ─── Pipeline toggle ──────────────────────────────────────────────────────────

function PipelineToggle({ running }: { running: boolean }) {
  const [loading, setLoading] = useState(false)
  async function toggle() {
    setLoading(true)
    try { running ? await stopPipeline() : await startPipeline() }
    catch {}
    finally { setLoading(false) }
  }
  return (
    <button onClick={toggle} disabled={loading}
      className={`text-label px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
        running
          ? "text-rose-400/70 border-rose-400/20 hover:border-rose-400/50 hover:text-rose-400"
          : "text-emerald-400/70 border-emerald-400/20 hover:border-emerald-400/50 hover:text-emerald-400"
      }`}>
      {loading ? "…" : running ? "stop" : "start"}
    </button>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TopStrip() {
  const { pipeline, pipelineStartedAt, entities } = useObservationStore()
  const { anomalies, predictions }                = usePredictionStore()
  const tank                                      = useTankStore((s) => s.tank)
  const [vlmActive, setVlmActive] = useState(false)
  const vlmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = () => {
      setVlmActive(true)
      if (vlmTimer.current) clearTimeout(vlmTimer.current)
      vlmTimer.current = setTimeout(() => setVlmActive(false), 60_000)
    }
    window.addEventListener("vlm_analysis", handler)
    return () => window.removeEventListener("vlm_analysis", handler)
  }, [])

  const identifiedCount = entities.filter((e) => (e.identity?.confidence ?? 0) >= 0.55).length
  const health          = pipeline.running ? pipeline.identity_resolution_health : null
  const pipelineColor   = pipeline.camera_active ? "healthy" : pipeline.running ? "warning" : "off"
  const highCount       = anomalies.filter((a) => a.severity === "high").length
  const medCount        = anomalies.filter((a) => a.severity === "medium").length
  const activePreds     = predictions.filter((p) => p.status === "active").length
  const queueLag        = pipeline.queue_lag_frames > 10

  return (
    <header className="flex items-center justify-between px-4 border-b border-border/40 bg-background/80 backdrop-blur-md shrink-0 h-10 pointer-events-auto gap-6">

      {/* Left */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-label font-semibold text-foreground tracking-widest">CONVICT</span>
        {tank && (
          <span className="text-label text-muted-foreground border border-border/50 rounded px-1.5 py-0.5">
            {tank.name}
          </span>
        )}
        {queueLag && (
          <span className="text-label text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5 animate-pulse"
            title="Detection queue falling behind">
            lag {pipeline.queue_lag_frames}f
          </span>
        )}
      </div>

      {/* Center */}
      <div className="flex items-center gap-5 flex-1 justify-center min-w-0">
        {pipeline.running && (
          <div className="flex items-center gap-3">
            <div className="flex flex-col leading-none gap-0.5">
              <span className="text-label text-muted-foreground">Entities</span>
              <span className="text-caption tabular-nums text-foreground" data-value>{entities.length}</span>
            </div>
            {entities.length > 0 && <IdRatioBar identified={identifiedCount} total={entities.length} />}
          </div>
        )}

        {pipeline.running && (
          <div className="flex items-center gap-1.5" title="Detection FPS">
            <FpsSparkline fps={pipeline.detection_fps} />
            <span className={`text-label tabular-nums ${
              pipeline.detection_fps >= 10 ? "text-emerald-400"
              : pipeline.detection_fps >= 5 ? "text-amber-400"
              : pipeline.detection_fps > 0  ? "text-rose-400"
              : "text-muted-foreground"
            }`} data-value>{pipeline.detection_fps.toFixed(1)}fps</span>
          </div>
        )}

        {health !== null && (
          <div className="flex items-center gap-1" title={`ID health: ${(health * 100).toFixed(0)}%`}>
            <ArcGauge value={health} />
            <span className="text-label text-foreground tabular-nums" data-value>{(health * 100).toFixed(0)}%</span>
          </div>
        )}

        {activePreds > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shrink-0" />
            <span className="text-label text-rose-400 tabular-nums" data-value>{activePreds} pred</span>
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 shrink-0">
        {(highCount > 0 || medCount > 0) && (
          <span className="text-label tabular-nums">
            {highCount > 0 && <span className="text-rose-400"  data-value>{highCount}H </span>}
            {medCount  > 0 && <span className="text-amber-400" data-value>{medCount}M</span>}
          </span>
        )}

        {vlmActive && (
          <span className="text-label text-blue-400 border border-blue-400/25 rounded px-1.5 py-0.5">VLM</span>
        )}

        <div className="flex items-center gap-1.5 text-label text-muted-foreground border-l border-border/40 pl-3">
          <Link href="/dashboard/graph"    className="hover:text-foreground transition-colors">graph</Link>
          <span className="opacity-30">/</span>
          <Link href="/dashboard/timeline" className="hover:text-foreground transition-colors">timeline</Link>
        </div>

        <PipelineToggle running={pipeline.running} />

        <div className="flex items-center gap-1.5 border-l border-border/40 pl-3">
          <Dot color={pipelineColor} />
          <div className="flex flex-col items-end leading-none gap-0.5">
            <span className="text-label text-muted-foreground">
              {pipeline.camera_active ? "LIVE" : pipeline.running ? "STARTING" : "OFFLINE"}
            </span>
            <Uptime startedAt={pipelineStartedAt} />
          </div>
        </div>
      </div>
    </header>
  )
}
