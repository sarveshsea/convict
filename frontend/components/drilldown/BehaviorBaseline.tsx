"use client"
import { useEffect, useRef, useState } from "react"
import { CANVAS_COLORS } from "@/lib/constants"
import { EmptyState } from "@/components/ui/empty-state"

interface BaselineData {
  mean_speed_px_per_frame: number
  speed_stddev: number
  activity_by_hour: Record<string, number>
  observation_frame_count: number
}

interface Props { baseline: BaselineData | null }

// ---------------------------------------------------------------------------
// Inline worker source — runs in a dedicated thread via OffscreenCanvas.
// Must be a self-contained string (no closure captures).
// ---------------------------------------------------------------------------
const WORKER_SOURCE = /* js */`
self.onmessage = function(e) {
  if (e.data.type !== "draw") return;
  var d = e.data.data;
  var canvas   = d.canvas;       // OffscreenCanvas transferred from main thread
  var hours    = d.hours;        // number[24]
  var colors   = d.colors;       // { bg, text }
  var W        = d.W;
  var H        = d.H;
  var currentHour = d.currentHour;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var padB  = 20, padT = 4;
  var maxVal = 1;
  for (var i = 0; i < hours.length; i++) { if (hours[i] > maxVal) maxVal = hours[i]; }

  var barW   = W / 24;
  var chartH = H - padB - padT;

  var startTime = null;
  var duration  = 300;

  function animate(ts) {
    if (startTime === null) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = 1 - Math.pow(1 - progress, 2);

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < 24; i++) {
      var barH = Math.max(1, (hours[i] / maxVal) * chartH * ease);
      var x    = i * barW;
      var y    = H - padB - barH;
      var t    = hours[i] / maxVal;

      if (i === currentHour) {
        ctx.fillStyle = "rgba(251,191,36," + (0.4 + t * 0.5) + ")";
      } else {
        ctx.fillStyle = "rgba(96,165,250," + (0.3 + t * 0.6) + ")";
      }
      ctx.fillRect(x + 1, y, barW - 2, barH);

      if (i === currentHour) {
        ctx.fillStyle = "rgba(251,191,36,0.8)";
        ctx.fillRect(x + 1, H - padB, barW - 2, 2);
      }
    }

    // Hour labels
    ctx.font = "8px 'Fira Code', monospace";
    ctx.textAlign = "center";
    var labels = [0, 6, 12, 18, 23];
    for (var li = 0; li < labels.length; li++) {
      var h = labels[li];
      ctx.fillStyle = (h === currentHour) ? "rgba(251,191,36,0.8)" : colors.text;
      ctx.fillText(String(h), h * barW + barW / 2, H - 5);
    }

    if (progress < 1) {
      self.requestAnimationFrame(animate);
    }
  }
  self.requestAnimationFrame(animate);
};
`

export function BehaviorBaseline({ baseline }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const hoursRef = useRef<number[]>([])
  // Keep a reference to the current worker so we can terminate it on cleanup
  const workerRef = useRef<Worker | null>(null)

  // -------------------------------------------------------------------------
  // Fallback: identical drawing logic executed on the main thread.
  // Used when OffscreenCanvas / transferControlToOffscreen is not supported.
  // -------------------------------------------------------------------------
  function drawMainThread() {
    const canvas = canvasRef.current
    if (!canvas || !baseline) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const W = rect.width, H = rect.height
    const padB = 20, padT = 4

    ctx.fillStyle = CANVAS_COLORS.bg
    ctx.fillRect(0, 0, W, H)

    const byHour = baseline.activity_by_hour
    const hours  = Array.from({ length: 24 }, (_, i) => Number(byHour[i] ?? 0))
    hoursRef.current = hours
    const maxVal = Math.max(...hours, 1)
    const currentHour = new Date().getHours()

    const barW  = W / 24
    const chartH = H - padB - padT

    let startTime: number | null = null
    const duration = 300

    function animate(ts: number) {
      if (!ctx) return
      if (!startTime) startTime = ts
      const progress = Math.min((ts - startTime) / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 2)

      ctx.fillStyle = CANVAS_COLORS.bg
      ctx.fillRect(0, 0, W, H)

      for (let i = 0; i < 24; i++) {
        const barH  = Math.max(1, (hours[i] / maxVal) * chartH * ease)
        const x     = i * barW
        const y     = H - padB - barH
        const t     = hours[i] / maxVal

        if (i === currentHour) {
          ctx.fillStyle = `rgba(251,191,36,${0.4 + t * 0.5})`
        } else {
          const alpha = 0.3 + t * 0.6
          ctx.fillStyle = `rgba(96,165,250,${alpha})`
        }
        ctx.fillRect(x + 1, y, barW - 2, barH)

        if (i === currentHour) {
          ctx.fillStyle = "rgba(251,191,36,0.8)"
          ctx.fillRect(x + 1, H - padB, barW - 2, 2)
        }
      }

      ctx.fillStyle = CANVAS_COLORS.text
      ctx.font = `8px 'Fira Code', monospace`
      ctx.textAlign = "center"
      for (const h of [0, 6, 12, 18, 23]) {
        ctx.fillStyle = h === currentHour ? "rgba(251,191,36,0.8)" : CANVAS_COLORS.text
        ctx.fillText(String(h), h * barW + barW / 2, H - 5)
      }

      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  // -------------------------------------------------------------------------
  // Main draw dispatcher: tries OffscreenCanvas + Worker, falls back to main.
  // -------------------------------------------------------------------------
  function draw() {
    const canvas = canvasRef.current
    if (!canvas || !baseline) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    const byHour = baseline.activity_by_hour
    const hours  = Array.from({ length: 24 }, (_, i) => Number(byHour[i] ?? 0))
    // Always keep hoursRef in sync so tooltip logic works on the main thread
    hoursRef.current = hours

    // Feature-detect OffscreenCanvas + transferControlToOffscreen
    const supportsOffscreen =
      typeof (canvas as HTMLCanvasElement & { transferControlToOffscreen?: () => OffscreenCanvas }).transferControlToOffscreen === "function"

    if (supportsOffscreen) {
      // Terminate any previously spawned worker before creating a new one
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }

      try {
        canvas.width  = rect.width  * dpr
        canvas.height = rect.height * dpr

        const offscreen = (canvas as HTMLCanvasElement & { transferControlToOffscreen: () => OffscreenCanvas }).transferControlToOffscreen()
        const blob   = new Blob([WORKER_SOURCE], { type: "application/javascript" })
        const url    = URL.createObjectURL(blob)
        const worker = new Worker(url)
        workerRef.current = worker
        URL.revokeObjectURL(url) // safe to revoke after Worker is created

        worker.postMessage(
          {
            type: "draw",
            data: {
              canvas: offscreen,
              hours,
              colors: { bg: CANVAS_COLORS.bg, text: CANVAS_COLORS.text },
              W: rect.width,
              H: rect.height,
              currentHour: new Date().getHours(),
            },
          },
          [offscreen]  // transfer ownership — zero-copy
        )
        return
      } catch {
        // transferControlToOffscreen can throw if the canvas context was already
        // obtained on the main thread (e.g. after a ResizeObserver re-trigger).
        // Fall through to the main-thread path in that case.
      }
    }

    drawMainThread()
  }

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [baseline])

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas || hoursRef.current.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const x    = e.clientX - rect.left
    const barW = rect.width / 24
    const hour = Math.floor(x / barW)
    if (hour >= 0 && hour < 24) {
      setTooltip({
        x: e.clientX - rect.left,
        y: 0,
        text: `${String(hour).padStart(2,"0")}:00 — ${hoursRef.current[hour]} events`,
      })
    }
  }

  if (!baseline) {
    return <EmptyState message="no baseline computed yet" height="lg" />
  }

  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">Behavioral Baseline</p>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Mean Speed",  value: `${baseline.mean_speed_px_per_frame.toFixed(1)} px/f` },
          { label: "Std Dev",     value: `±${baseline.speed_stddev.toFixed(1)}` },
          { label: "Obs Frames",  value: baseline.observation_frame_count.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="px-2 py-1.5 rounded border border-border/30 bg-card">
            <p className="text-label text-muted-foreground">{label}</p>
            <p className="text-detail font-mono text-foreground mt-0.5" data-value>{value}</p>
          </div>
        ))}
      </div>

      <div ref={containerRef} className="relative">
        <p className="text-label text-muted-foreground mb-1">Activity by Hour (UTC)</p>
        <canvas
          ref={canvasRef}
          className="w-full h-20 rounded border border-border/40"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip && (
          <div
            className="absolute top-0 pointer-events-none bg-card border border-border rounded px-2 py-1 text-label text-foreground whitespace-nowrap z-10 shadow-lg -translate-y-full"
            style={{ left: Math.min(tooltip.x, 200) }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  )
}
