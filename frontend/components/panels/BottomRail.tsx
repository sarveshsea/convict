"use client"
import { useEffect, useState } from "react"
import { usePredictionStore } from "@/store/predictionStore"
import { useObservationStore } from "@/store/observationStore"
import { formatTime } from "@/lib/timeUtils"

const EVENT_DOT: Record<string, string> = {
  chase: "bg-rose-500", harassment: "bg-rose-400", hiding: "bg-amber-400",
  missing_fish: "bg-rose-500 animate-pulse", schooling: "bg-emerald-400",
  lethargy: "bg-amber-400", dispersion: "bg-zinc-400",
}

export function BottomRail() {
  const anomalies = usePredictionStore((s) => s.anomalies)
  const { pipeline, scheduleContext } = useObservationStore()

  return (
    <footer className="h-8 shrink-0 border-t border-zinc-800/60 bg-zinc-950/75 backdrop-blur-md flex items-center px-4 gap-4 overflow-x-auto scrollbar-thin pointer-events-auto">
      {/* Pipeline telemetry */}
      <div className="flex items-center gap-3 shrink-0 pr-4 border-r border-zinc-800/60">
        <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
          {pipeline.detection_fps > 0 ? `${pipeline.detection_fps.toFixed(1)} fps` : "0 fps"}
        </span>
        {pipeline.inference_latency_ms > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
            {pipeline.inference_latency_ms.toFixed(0)}ms
          </span>
        )}
        <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
          {pipeline.track_count} tracks
        </span>
      </div>

      {/* Recent events as timeline dots */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {anomalies.slice(0, 20).reverse().map((a) => (
          <div key={a.uuid} className="flex items-center gap-1 shrink-0 group relative">
            <span className={`w-1.5 h-1.5 rounded-full ${EVENT_DOT[a.event_type] ?? "bg-zinc-500"}`} />
            {/* Tooltip */}
            <div className="absolute bottom-5 left-0 hidden group-hover:block bg-zinc-900 border border-border rounded px-2 py-1 text-[9px] font-mono text-foreground whitespace-nowrap z-10 shadow-lg">
              {a.event_type.replace(/_/g, " ")} · {a.involved_fish.map((f) => f.fish_name).join(", ")} · {formatTime(a.started_at)}
            </div>
          </div>
        ))}
        {anomalies.length === 0 && (
          <span className="text-[9px] font-mono text-muted-foreground">No events yet</span>
        )}
      </div>

      {/* Right — schedule context */}
      {scheduleContext && (
        <span className="shrink-0 text-[9px] font-mono text-amber-400/70 tabular-nums">
          {scheduleContext.replace("_", " ")}
        </span>
      )}

      {/* Clock */}
      <Clock />
    </footer>
  )
}

function Clock() {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("en-US", { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  if (!t) return null
  return <span className="shrink-0 text-[9px] font-mono text-muted-foreground tabular-nums">{t}</span>
}
