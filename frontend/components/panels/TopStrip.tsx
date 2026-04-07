"use client"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"

function Dot({ color }: { color: "healthy" | "warning" | "critical" | "off" }) {
  const cls = {
    healthy: "bg-emerald-400",
    warning: "bg-amber-400",
    critical: "bg-rose-500 animate-pulse",
    off: "bg-zinc-600",
  }[color]
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
      <span className="text-sm font-mono font-medium text-foreground tabular-nums leading-tight">
        {value}
        {sub && <span className="text-[10px] text-muted-foreground ml-0.5">{sub}</span>}
      </span>
    </div>
  )
}

export function TopStrip() {
  const { pipeline, entities, scheduleContext } = useObservationStore()
  const { anomalies, predictions } = usePredictionStore()
  const tank = useTankStore((s) => s.tank)

  const identifiedCount = entities.filter((e) => (e.identity?.confidence ?? 0) >= 0.55).length
  const health = pipeline.running
    ? pipeline.identity_resolution_health
    : null

  const pipelineColor = pipeline.camera_active ? "healthy" : pipeline.running ? "warning" : "off"
  const activeCritical = anomalies.filter((a) => a.severity === "high").length

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/75 backdrop-blur-md shrink-0 h-10 pointer-events-auto">
      {/* Left — identity */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono font-semibold text-foreground tracking-tight mr-3">CONVICT</span>
        {tank && (
          <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {tank.name}
          </span>
        )}
        {scheduleContext && (
          <span className="text-[10px] font-mono text-amber-400 border border-amber-400/30 bg-amber-400/10 rounded px-1.5 py-0.5">
            {scheduleContext.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Center — live stats */}
      <div className="flex items-center gap-6">
        <Stat label="Entities" value={entities.length} />
        <Stat label="Identified" value={`${identifiedCount}/${entities.length}`} />
        {pipeline.running && (
          <Stat label="Det. FPS" value={pipeline.detection_fps.toFixed(1)} />
        )}
        {health !== null && (
          <Stat label="ID Health" value={`${(health * 100).toFixed(0)}%`} />
        )}
        {predictions.filter((p) => p.status === "active").length > 0 && (
          <Stat label="Predictions" value={predictions.filter((p) => p.status === "active").length} />
        )}
      </div>

      {/* Right — pipeline status + alerts */}
      <div className="flex items-center gap-3">
        {activeCritical > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-rose-400 border border-rose-400/30 bg-rose-400/10 rounded px-1.5 py-0.5">
            <Dot color="critical" />
            {activeCritical} HIGH
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <Dot color={pipelineColor} />
          {pipeline.camera_active ? "LIVE" : pipeline.running ? "STARTING" : "OFFLINE"}
        </span>
      </div>
    </header>
  )
}
