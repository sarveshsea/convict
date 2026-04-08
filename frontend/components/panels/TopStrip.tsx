"use client"
import { useEffect, useRef, useState } from "react"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"

// ─── Status dot ──────────────────────────────────────────────────────────────

function Dot({ color }: { color: "healthy" | "warning" | "critical" | "off" }) {
  const cls = {
    healthy:  "bg-status-healthy",
    warning:  "bg-status-warning",
    critical: "bg-status-critical animate-pulse",
    off:      "bg-status-unknown",
  }[color]
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />
}

// ─── FPS sparkline (40×14px SVG polyline) ────────────────────────────────────

function FpsSparkline({ fps }: { fps: number }) {
  const history = useRef<number[]>([])
  const [path, setPath] = useState("")

  useEffect(() => {
    history.current = [...history.current.slice(-19), fps]
    const vals = history.current
    if (vals.length < 2) return
    const max  = Math.max(...vals, 1)
    const W = 40, H = 14
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W
      const y = H - (v / max) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    setPath(`M ${pts.join(" L ")}`)
  }, [fps])

  const color = fps >= 10 ? "#34d399" : fps >= 5 ? "#fbbf24" : "#f87171"

  return (
    <svg width={40} height={14} className="overflow-visible">
      {path && <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8" />}
    </svg>
  )
}

// ─── ID ratio bar ─────────────────────────────────────────────────────────────

function IdRatioBar({ identified, total }: { identified: number; total: number }) {
  const pct = total > 0 ? identified / total : 0
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-muted-foreground">Identified</span>
      <div className="flex items-center gap-1.5">
        <div className="w-12 h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-status-healthy transition-all duration-300"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <span className="text-caption text-foreground tabular-nums leading-tight" data-value>
          {identified}/{total}
        </span>
      </div>
    </div>
  )
}

// ─── Semicircle arc gauge ─────────────────────────────────────────────────────

function ArcGauge({ value }: { value: number }) {
  // 180° sweep arc, 32×18px
  const r  = 13
  const cx = 16, cy = 16
  const startAngle = Math.PI     // left = 180°
  const sweep      = Math.PI * value
  const endAngle   = startAngle + sweep
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const large = sweep > Math.PI ? 1 : 0
  const color = value >= 0.7 ? "#34d399" : value >= 0.4 ? "#fbbf24" : "#f87171"

  return (
    <svg width={32} height={18} className="overflow-visible">
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(63,63,70,0.5)" strokeWidth="2" strokeLinecap="round"
      />
      {value > 0 && (
        <path
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
        />
      )}
    </svg>
  )
}

// ─── Uptime counter ───────────────────────────────────────────────────────────

function Uptime({ startedAt }: { startedAt: string | null }) {
  const [label, setLabel] = useState("")
  useEffect(() => {
    if (!startedAt) return
    const tick = () => {
      const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      setLabel(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!label) return null
  return <span className="text-label text-muted-foreground tabular-nums" data-value>{label}</span>
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TopStrip() {
  const { pipeline, entities, scheduleContext } = useObservationStore()
  const { anomalies, predictions } = usePredictionStore()
  const tank = useTankStore((s) => s.tank)
  const [vlmActive, setVlmActive] = useState(false)
  const vlmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for vlm_analysis WS events via a custom DOM event (WSProvider fires these)
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
  const pipelineColor   = pipeline.camera_active ? "healthy" : (pipeline.running || pipeline.camera_restarting) ? "warning" : "off"

  const highCount   = anomalies.filter((a) => a.severity === "high").length
  const medCount    = anomalies.filter((a) => a.severity === "medium").length
  const activePreds = predictions.filter((p) => p.status === "active").length

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-background/75 backdrop-blur-md shrink-0 h-10 pointer-events-auto">
      {/* Left */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-semibold text-foreground tracking-tight mr-1">CONVICT</span>
        {tank && (
          <span className="text-caption text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {tank.name}
          </span>
        )}
        {scheduleContext && (
          <span className="text-caption text-amber-400 border border-amber-400/30 bg-amber-400/10 rounded px-1.5 py-0.5">
            {scheduleContext.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Center — live stats */}
      <div className="flex items-center gap-5">
        {/* Entity count */}
        <div className="flex flex-col">
          <span className="text-label text-muted-foreground">Entities</span>
          <span className="text-sm font-mono font-medium text-foreground tabular-nums leading-tight" data-value>
            {entities.length}
          </span>
        </div>

        {/* Identified ratio bar */}
        <IdRatioBar identified={identifiedCount} total={entities.length} />

        {/* FPS sparkline */}
        {pipeline.running && (
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-muted-foreground">Det. FPS</span>
            <div className="flex items-center gap-1.5">
              <FpsSparkline fps={pipeline.detection_fps} />
              <span
                className={`text-caption tabular-nums leading-tight ${
                  pipeline.detection_fps >= 10 ? "text-emerald-400"
                  : pipeline.detection_fps >= 5 ? "text-amber-400"
                  : "text-rose-400"
                }`}
                data-value
              >
                {pipeline.detection_fps.toFixed(1)}
              </span>
            </div>
          </div>
        )}

        {/* ID Health arc gauge */}
        {health !== null && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-label text-muted-foreground">ID Health</span>
            <div className="flex items-center gap-1">
              <ArcGauge value={health} />
              <span className="text-caption text-foreground tabular-nums" data-value>
                {(health * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}

        {/* Predictions pulse */}
        {activePreds > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            <span className="text-caption text-rose-400 tabular-nums" data-value>{activePreds}</span>
            <span className="text-label text-muted-foreground ml-0.5">pred</span>
          </div>
        )}
      </div>

      {/* Right — pipeline + alerts */}
      <div className="flex items-center gap-3">
        {/* Severity dots */}
        {(highCount > 0 || medCount > 0) && (
          <div className="flex items-center gap-1">
            {highCount > 0 && (
              <span className="flex items-center gap-0.5 text-caption text-rose-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span data-value>{highCount}</span>
              </span>
            )}
            {medCount > 0 && (
              <span className="flex items-center gap-0.5 text-caption text-amber-400 ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span data-value>{medCount}</span>
              </span>
            )}
          </div>
        )}

        {/* VLM badge */}
        {vlmActive && (
          <span className="text-label text-blue-400 border border-blue-400/30 bg-blue-400/10 rounded px-1.5 py-0.5">
            VLM
          </span>
        )}

        {/* Pipeline status + uptime */}
        <div className="flex items-center gap-1.5">
          <Dot color={pipelineColor} />
          <div className="flex flex-col items-end">
            <span className="text-caption text-muted-foreground leading-none">
              {pipeline.camera_active ? "LIVE" : pipeline.camera_restarting ? "RECONNECTING" : pipeline.running ? "STARTING" : "OFFLINE"}
            </span>
            {pipeline.camera_active && <Uptime startedAt={pipeline.running ? new Date(Date.now() - 1000).toISOString() : null} />}
          </div>
        </div>
      </div>
    </header>
  )
}
