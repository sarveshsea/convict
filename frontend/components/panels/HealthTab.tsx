"use client"
import { useEffect, useState } from "react"
import { getHealth, type HealthResponse } from "@/lib/api"
import { SectionHeader } from "@/components/ui/section-header"

function tickColor(alive: boolean, ago: number | null): string {
  if (!alive) return "bg-rose-400"
  if (ago === null) return "bg-zinc-500"
  if (ago < 30)  return "bg-emerald-400"
  if (ago < 120) return "bg-amber-400"
  return "bg-rose-400"
}

function fmtAgo(ago: number | null): string {
  if (ago === null) return "—"
  if (ago < 1)   return "<1s"
  if (ago < 60)  return `${Math.round(ago)}s`
  if (ago < 3600) return `${Math.round(ago / 60)}m`
  return `${Math.round(ago / 3600)}h`
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "never"
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function HealthTab() {
  const [health, setHealth]   = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = () => {
      getHealth()
        .then((h) => {
          if (cancelled) return
          setHealth(h)
          setError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : "health endpoint unavailable")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    fetchOnce()
    const id = setInterval(fetchOnce, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-caption text-muted-foreground">loading…</span>
      </div>
    )
  }

  if (error || !health) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-caption text-rose-400">{error ?? "health endpoint unavailable"}</p>
      </div>
    )
  }

  const taskEntries = Object.entries(health.tasks)
  const writerWarn = health.writer.dropped > 0 || health.writer.errors > 0

  return (
    <div className="flex flex-col divide-y divide-border/40 overflow-y-auto scrollbar-thin">
      {/* Version header */}
      <div className="px-3 py-2 flex items-center justify-between shrink-0">
        <span className="text-label text-muted-foreground">Convict</span>
        <span className="text-label text-muted-foreground font-mono" data-value>{health.version}</span>
      </div>

      {/* Tasks */}
      <div>
        <SectionHeader label="Tasks" count={taskEntries.length} countColor="text-muted-foreground" />
        {taskEntries.length === 0 ? (
          <p className="px-3 py-2 text-caption text-muted-foreground">no tasks reported</p>
        ) : (
          <div className="divide-y divide-border/30">
            {taskEntries.map(([name, t]) => (
              <div key={name} className="px-3 py-2 flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${tickColor(t.alive, t.last_tick_ago_s)}`} />
                <span className="text-caption text-foreground flex-1 truncate font-mono">{name}</span>
                <span className="text-label text-muted-foreground tabular-nums shrink-0" data-value>
                  {fmtAgo(t.last_tick_ago_s)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Streaming */}
      <div>
        <SectionHeader label="Streaming" count={2} countColor="text-muted-foreground" />
        <div className="divide-y divide-border/30">
          {(["hls1", "hls2"] as const).map((k) => {
            const state = health.ffmpeg[k]
            const pid   = k === "hls1" ? health.ffmpeg.hls1_pid : health.ffmpeg.hls2_pid
            const dot   = state === "running" ? "bg-emerald-400" : "bg-zinc-500"
            return (
              <div key={k} className="px-3 py-2 flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <span className="text-caption text-foreground flex-1 font-mono">{k}</span>
                <span className="text-label text-muted-foreground shrink-0">{state}</span>
                {pid != null && (
                  <span className="text-label text-muted-foreground/50 tabular-nums shrink-0" data-value>pid {pid}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* VLM (Ollama) */}
      <div>
        <SectionHeader label="VLM" countColor="text-muted-foreground" />
        <div className={`px-3 py-2 space-y-1 ${health.ollama.enabled ? "" : "opacity-40"}`}>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              !health.ollama.enabled ? "bg-zinc-500"
              : health.ollama.reachable ? "bg-emerald-400" : "bg-rose-400"
            }`} />
            <span className="text-caption text-foreground flex-1 font-mono">{health.ollama.model || "—"}</span>
            <span className="text-label text-muted-foreground shrink-0">
              {!health.ollama.enabled ? "disabled" : health.ollama.reachable ? "reachable" : "unreachable"}
            </span>
          </div>
          {health.ollama.latency_ms !== null && (
            <div className="flex items-center justify-between">
              <span className="text-label text-muted-foreground">latency</span>
              <span className="text-label text-muted-foreground tabular-nums" data-value>{Math.round(health.ollama.latency_ms)}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Smart Plugs */}
      <div>
        <SectionHeader label="Smart Plugs" count={health.plugs.length} countColor="text-muted-foreground" />
        {health.plugs.length === 0 ? (
          <p className="px-3 py-2 text-caption text-muted-foreground">none configured</p>
        ) : (
          <div className="divide-y divide-border/30">
            {health.plugs.map((p) => (
              <div key={p.ip} className="px-3 py-2 flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.reachable ? "bg-emerald-400" : "bg-rose-400"}`} />
                <span className="text-caption text-foreground flex-1 truncate">{p.label}</span>
                <span className="text-label text-muted-foreground/60 font-mono shrink-0">{p.ip}</span>
                <span className={`text-label px-1.5 py-0.5 rounded border shrink-0 ${
                  p.is_on
                    ? "border-emerald-400/40 text-emerald-400 bg-emerald-400/10"
                    : "border-border/50 text-muted-foreground"
                }`}>
                  {p.is_on ? "on" : "off"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Database */}
      <div>
        <SectionHeader label="Database" countColor="text-muted-foreground" />
        <div className="px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-label text-muted-foreground">size</span>
            <span className="text-label text-foreground tabular-nums font-mono" data-value>{health.db.size_mb.toFixed(1)} MB</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label text-muted-foreground">behavior_events</span>
            <span className="text-label text-foreground tabular-nums font-mono" data-value>{health.db.behavior_events.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label text-muted-foreground">interaction_edges</span>
            <span className="text-label text-foreground tabular-nums font-mono" data-value>{health.db.interaction_edges.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label text-muted-foreground">behavior_baselines</span>
            <span className="text-label text-foreground tabular-nums font-mono" data-value>{health.db.behavior_baselines.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <span className="text-label text-muted-foreground">last retention</span>
            <span className="text-label text-muted-foreground tabular-nums font-mono">{fmtTimestamp(health.db.last_retention_run)}</span>
          </div>
          {health.db.last_retention_deleted && (
            <div className="text-label text-muted-foreground/70 tabular-nums">
              purged: {health.db.last_retention_deleted.behavior_events_deleted} events ·{" "}
              {health.db.last_retention_deleted.interaction_edges_deleted} edges ·{" "}
              {health.db.last_retention_deleted.detection_frame_deleted} frames
            </div>
          )}
        </div>
      </div>

      {/* DB Writer */}
      <div>
        <SectionHeader label="DB Writer" countColor="text-muted-foreground" />
        <div className="px-3 py-2 grid grid-cols-2 gap-1.5">
          <div className="rounded border border-border/40 px-2 py-1.5">
            <p className="text-label text-muted-foreground">queue</p>
            <p className="text-caption font-mono text-foreground tabular-nums" data-value>{health.writer.queue_depth}</p>
          </div>
          <div className="rounded border border-border/40 px-2 py-1.5">
            <p className="text-label text-muted-foreground">committed</p>
            <p className="text-caption font-mono text-foreground tabular-nums" data-value>{health.writer.committed.toLocaleString()}</p>
          </div>
          <div className={`rounded border px-2 py-1.5 ${health.writer.dropped > 0 ? "border-rose-400/40 bg-rose-500/5" : "border-border/40"}`}>
            <p className="text-label text-muted-foreground">dropped</p>
            <p className={`text-caption font-mono tabular-nums ${health.writer.dropped > 0 ? "text-rose-400" : "text-foreground"}`} data-value>
              {health.writer.dropped}
            </p>
          </div>
          <div className={`rounded border px-2 py-1.5 ${health.writer.errors > 0 ? "border-rose-400/40 bg-rose-500/5" : "border-border/40"}`}>
            <p className="text-label text-muted-foreground">errors</p>
            <p className={`text-caption font-mono tabular-nums ${health.writer.errors > 0 ? "text-rose-400" : "text-foreground"}`} data-value>
              {health.writer.errors}
            </p>
          </div>
        </div>
        {writerWarn && (
          <p className="px-3 pb-2 text-label text-rose-400/80">writer is degraded — check backend logs</p>
        )}
      </div>
    </div>
  )
}
