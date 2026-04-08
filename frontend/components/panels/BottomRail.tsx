"use client"
import { useEffect, useRef, useState } from "react"
import { usePredictionStore } from "@/store/predictionStore"
import { useObservationStore } from "@/store/observationStore"
import { EVENT_DOT } from "@/lib/constants"

// ─── Event frequency histogram ────────────────────────────────────────────────

function EventHistogram({ anomalies }: { anomalies: { started_at: string; severity: string }[] }) {
  const BUCKETS = 12
  const W = 60, H = 14
  const now = Date.now()
  const buckets = Array.from({ length: BUCKETS }, (_, i) => {
    const bucketStart = now - (BUCKETS - i) * 5 * 60_000
    const bucketEnd   = bucketStart + 5 * 60_000
    const events = anomalies.filter((a) => {
      const t = new Date(a.started_at).getTime()
      return t >= bucketStart && t < bucketEnd
    })
    const hasHigh = events.some((e) => e.severity === "high")
    const count   = events.length
    return { count, color: hasHigh ? "#f87171" : count > 0 ? "#fbbf24" : "rgba(63,63,70,0.3)" }
  })
  const max  = Math.max(...buckets.map((b) => b.count), 1)
  const barW = W / BUCKETS
  return (
    <svg width={W} height={H} className="shrink-0">
      {buckets.map((b, i) => (
        <rect key={i}
          x={i * barW + 0.5} y={H - (b.count / max) * H}
          width={barW - 1} height={(b.count / max) * H || 1}
          fill={b.color} opacity={0.85}
        />
      ))}
    </svg>
  )
}

// ─── Track sparkline ─────────────────────────────────────────────────────────

function TrackSparkline({ count }: { count: number }) {
  const history = useRef<number[]>([])
  const [path, setPath] = useState("")
  const W = 24, H = 10
  useEffect(() => {
    history.current = [...history.current.slice(-29), count]
    const vals = history.current
    if (vals.length < 2) return
    const max = Math.max(...vals, 1)
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W
      const y = H - (v / max) * (H - 1)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    setPath(`M ${pts.join(" L ")}`)
  }, [count])
  return (
    <svg width={W} height={H} className="overflow-visible opacity-70">
      {path && <path d={path} fill="none" stroke="#60a5fa" strokeWidth="1" strokeLinejoin="round" />}
    </svg>
  )
}

// ─── Event grouping ───────────────────────────────────────────────────────────

interface GroupedEvent {
  event_type: string; severity: string; last_at: string
  count: number; fish_names: string[]; uuid: string
}

function groupEvents(anomalies: { uuid: string; event_type: string; severity: string; started_at: string; involved_fish: { fish_name: string }[] }[]) {
  const groups: GroupedEvent[] = []
  for (const a of [...anomalies].reverse()) {
    const last = groups[groups.length - 1]
    if (last && last.event_type === a.event_type) {
      last.count++
      last.last_at = a.started_at
      last.fish_names = [...new Set([...last.fish_names, ...a.involved_fish.map((f) => f.fish_name)])]
    } else {
      groups.push({
        event_type: a.event_type, severity: a.severity,
        last_at: a.started_at, count: 1,
        fish_names: a.involved_fish.map((f) => f.fish_name),
        uuid: a.uuid,
      })
    }
  }
  return groups.slice(0, 20)
}

function dotOpacity(startedAt: string): string {
  const age = (Date.now() - new Date(startedAt).getTime()) / 60_000
  if (age < 5)  return "opacity-100"
  if (age < 15) return "opacity-60"
  return "opacity-30"
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ─── Clock ────────────────────────────────────────────────────────────────────

function Clock() {
  const [t, setT] = useState<string | null>(null)
  const [d, setD] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setT(now.toLocaleTimeString("en-US", { hour12: false }))
      setD(now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  if (!t) return null
  return <span className="shrink-0 text-label text-muted-foreground tabular-nums" data-value title={d ?? undefined}>{t}</span>
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BottomRail() {
  const anomalies                     = usePredictionStore((s) => s.anomalies)
  const { pipeline, scheduleContext } = useObservationStore()
  const grouped = groupEvents(anomalies)

  const fpsColor = pipeline.detection_fps >= 10 ? "text-emerald-400"
    : pipeline.detection_fps >= 5 ? "text-amber-400"
    : pipeline.detection_fps > 0  ? "text-rose-400"
    : "text-muted-foreground"
  const latColor = pipeline.inference_latency_ms <= 50  ? "text-emerald-400"
    : pipeline.inference_latency_ms <= 100 ? "text-amber-400"
    : pipeline.inference_latency_ms > 0    ? "text-rose-400"
    : "text-muted-foreground"

  return (
    <footer className="h-8 shrink-0 border-t border-border/40 bg-background/80 backdrop-blur-md flex items-center px-4 gap-4 overflow-x-auto scrollbar-thin pointer-events-auto">

      {scheduleContext && (
        <span className="shrink-0 text-label text-amber-400/70 pr-3 border-r border-border/40">
          {scheduleContext.replace("_", " ")}
        </span>
      )}

      {/* Telemetry — single block, 1 border-r */}
      <div className="flex items-center gap-3 shrink-0 pr-4 border-r border-border/40">
        <span className="text-label tabular-nums">
          <span className={fpsColor} data-value>
            {pipeline.detection_fps > 0 ? `${pipeline.detection_fps.toFixed(1)}fps` : "0fps"}
          </span>
          {pipeline.inference_latency_ms > 0 && (
            <span className={latColor} data-value> · {pipeline.inference_latency_ms.toFixed(0)}ms</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <TrackSparkline count={pipeline.track_count} />
          <span className="text-label text-muted-foreground tabular-nums" data-value>{pipeline.track_count}t</span>
        </div>
        {anomalies.length > 0 && <EventHistogram anomalies={anomalies} />}
      </div>

      {/* Event stream */}
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
        {grouped.length === 0
          ? <span className="text-label text-muted-foreground/40">quiet</span>
          : grouped.map((g) => (
            <div key={g.uuid} className={`flex items-center gap-0.5 shrink-0 group relative ${dotOpacity(g.last_at)}`}>
              <span className={`w-2 h-2 rounded-full ${EVENT_DOT[g.event_type] ?? "bg-zinc-500"}`} />
              {g.count > 1 && <span className="text-label text-muted-foreground">×{g.count}</span>}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col bg-card border border-border/60 rounded px-2 py-1 text-label text-foreground whitespace-nowrap z-20 shadow-lg gap-0.5">
                <span>{g.event_type.replace(/_/g, " ")}{g.count > 1 ? ` ×${g.count}` : ""}</span>
                {g.fish_names.length > 0 && <span className="text-muted-foreground">{g.fish_names.join(", ")}</span>}
                <span className="text-muted-foreground">{formatTime(g.last_at)}</span>
              </div>
            </div>
          ))
        }
      </div>

      <Clock />
    </footer>
  )
}
