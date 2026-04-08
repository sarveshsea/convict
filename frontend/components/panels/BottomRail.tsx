"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePredictionStore } from "@/store/predictionStore"
import { useObservationStore } from "@/store/observationStore"
import { EVENT_DOT } from "@/lib/constants"
import { formatTime } from "@/lib/timeUtils"

// ─── Event frequency histogram (last 60min in 5min buckets) ──────────────────

function EventHistogram({ anomalies }: { anomalies: { started_at: string; severity: string }[] }) {
  const BUCKETS = 12   // 12 × 5min = 60min
  const W = 60, H = 12
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
    return { count, color: hasHigh ? "#f87171" : count > 0 ? "#fbbf24" : "rgba(63,63,70,0.4)" }
  })

  const max = Math.max(...buckets.map((b) => b.count), 1)
  const barW = W / BUCKETS

  return (
    <svg width={W} height={H} className="shrink-0">
      {buckets.map((b, i) => (
        <rect
          key={i}
          x={i * barW + 0.5}
          y={H - (b.count / max) * H}
          width={barW - 1}
          height={(b.count / max) * H || 1}
          fill={b.color}
          opacity={0.85}
        />
      ))}
    </svg>
  )
}

// ─── Track count sparkline ────────────────────────────────────────────────────

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
    <svg width={W} height={H} className="overflow-visible opacity-60">
      {path && <path d={path} fill="none" stroke="#60a5fa" strokeWidth="1" strokeLinejoin="round" />}
    </svg>
  )
}

// ─── Grouped event dots ───────────────────────────────────────────────────────

interface GroupedEvent {
  event_type: string
  severity: string
  last_at: string
  count: number
  fish_names: string[]
  uuid: string
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
        event_type: a.event_type,
        severity:   a.severity,
        last_at:    a.started_at,
        count:      1,
        fish_names: a.involved_fish.map((f) => f.fish_name),
        uuid:       a.uuid,
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

// ─── Clock ────────────────────────────────────────────────────────────────────

function Clock() {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("en-US", { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  if (!t) return null
  return <span className="shrink-0 text-label text-muted-foreground tabular-nums" data-value>{t}</span>
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BottomRail() {
  const anomalies = usePredictionStore((s) => s.anomalies)
  const { pipeline, scheduleContext } = useObservationStore()
  const grouped = groupEvents(anomalies)

  const fpsColor = pipeline.detection_fps >= 10 ? "text-emerald-400"
    : pipeline.detection_fps >= 5 ? "text-amber-400"
    : pipeline.detection_fps > 0 ? "text-rose-400"
    : "text-muted-foreground"

  const latColor = pipeline.inference_latency_ms <= 50 ? "text-emerald-400"
    : pipeline.inference_latency_ms <= 100 ? "text-amber-400"
    : pipeline.inference_latency_ms > 0 ? "text-rose-400"
    : "text-muted-foreground"

  return (
    <footer className="h-8 shrink-0 border-t border-border/40 bg-background/75 backdrop-blur-md flex items-center px-4 gap-4 overflow-x-auto scrollbar-thin pointer-events-auto">
      {/* Schedule context (left of divider so it reads as pipeline state) */}
      {scheduleContext && (
        <span className="shrink-0 text-label text-amber-400/70 tabular-nums pr-3 border-r border-border/40">
          {scheduleContext.replace("_", " ")}
        </span>
      )}

      {/* Pipeline telemetry */}
      <div className="flex items-center gap-4 shrink-0 pr-4 border-r border-border/40">
        <span className={`text-label tabular-nums ${fpsColor}`} data-value>
          {pipeline.detection_fps > 0 ? `${pipeline.detection_fps.toFixed(1)} fps` : "0 fps"}
        </span>
        {pipeline.inference_latency_ms > 0 && (
          <span className={`text-label tabular-nums ${latColor}`} data-value>
            {pipeline.inference_latency_ms.toFixed(0)}ms
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <TrackSparkline count={pipeline.track_count} />
          <span className="text-label text-muted-foreground tabular-nums" data-value>
            {pipeline.track_count} tracks
          </span>
        </div>
      </div>

      {/* Event histogram */}
      {anomalies.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 pr-4 border-r border-border/40">
          <EventHistogram anomalies={anomalies} />
        </div>
      )}

      {/* Event dot timeline */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {grouped.map((g) => (
          <div key={g.uuid} className={`flex items-center gap-0.5 shrink-0 group relative ${dotOpacity(g.last_at)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${EVENT_DOT[g.event_type] ?? "bg-zinc-500"}`} />
            {g.count > 1 && (
              <span className="text-label text-muted-foreground">×{g.count}</span>
            )}
            {/* Tooltip — centered above dot */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-card border border-border rounded px-2 py-1 text-label text-foreground whitespace-nowrap z-10 shadow-lg">
              {g.event_type.replace(/_/g, " ")}
              {g.fish_names.length > 0 && ` · ${g.fish_names.join(", ")}`}
              {` · ${formatTime(g.last_at)}`}
              {g.count > 1 && ` (×${g.count})`}
            </div>
          </div>
        ))}
        {anomalies.length === 0 && (
          <span className="text-label text-muted-foreground">no events yet</span>
        )}
      </div>

      {/* Nav links */}
      <div className="ml-auto flex items-center gap-2 shrink-0 pl-3 border-l border-border/40">
        <Link href="/dashboard/graph" className="text-label text-muted-foreground hover:text-foreground transition-colors">graph</Link>
        <span className="text-border">/</span>
        <Link href="/dashboard/timeline" className="text-label text-muted-foreground hover:text-foreground transition-colors">timeline</Link>
      </div>

      {/* Clock */}
      <Clock />
    </footer>
  )
}
