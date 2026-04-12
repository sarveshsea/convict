"use client"
import { useEffect, useRef, useState } from "react"
import { getClarityHistory, type ClarityHistoryResponse, type ClaritySample } from "@/lib/api"
import { CANVAS_COLORS } from "@/lib/constants"

const FLOW_LINE: Record<string, string> = {
  ok:        "rgba(52,211,153,0.85)",
  degrading: "rgba(251,191,36,0.85)",
  stalled:   "rgba(244,63,94,0.85)",
}
const FLOW_FILL: Record<string, string> = {
  ok:        "rgba(52,211,153,0.10)",
  degrading: "rgba(251,191,36,0.10)",
  stalled:   "rgba(244,63,94,0.10)",
}
const FLOW_TEXT: Record<string, string> = {
  ok:        "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  degrading: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  stalled:   "text-rose-400 border-rose-400/30 bg-rose-400/10",
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  } catch { return "—" }
}

export function ClarityTrend() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data, setData]       = useState<ClarityHistoryResponse | null>(null)
  const [error, setError]     = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = () => {
      getClarityHistory()
        .then((r) => { if (!cancelled) { setData(r); setError(false) } })
        .catch(() => { if (!cancelled) setError(true) })
    }
    fetchOnce()
    const id = setInterval(fetchOnce, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.samples.length < 2) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width, H = rect.height
    const padL = 24, padR = 6, padT = 6, padB = 14
    const cW = W - padL - padR
    const cH = H - padT - padB

    ctx.fillStyle = CANVAS_COLORS.bg
    ctx.fillRect(0, 0, W, H)

    const samples = data.samples
    const vals = samples.map((s) => s.clarity)
    const maxVal = Math.max(...vals, 0.1)
    const minVal = Math.min(...vals, 0)
    const range = Math.max(maxVal - minVal, 0.05)

    // Y grid
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const y = padT + cH * (1 - i / steps)
      const label = (minVal + (range * i) / steps).toFixed(2)
      ctx.strokeStyle = CANVAS_COLORS.grid
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke()
      ctx.fillStyle = CANVAS_COLORS.text
      ctx.font = "7px 'Fira Code', monospace"
      ctx.textAlign = "right"
      ctx.fillText(label, padL - 2, y + 3)
    }

    const n = samples.length
    const stepX = cW / (n - 1)
    const points = samples.map((s, i) => ({
      x: padL + i * stepX,
      y: padT + cH * (1 - (s.clarity - minVal) / range),
    }))

    const status = data.current.flow_status ?? "ok"
    const lineColor = FLOW_LINE[status] ?? FLOW_LINE.ok
    const fillColor = FLOW_FILL[status] ?? FLOW_FILL.ok

    // Area fill
    ctx.beginPath()
    ctx.moveTo(points[0].x, padT + cH)
    points.forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[n - 1].x, padT + cH)
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()

    // Line
    ctx.beginPath()
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.5
    ctx.stroke()

    // X axis tick labels (first/last)
    ctx.fillStyle = CANVAS_COLORS.text
    ctx.font = "7px 'Fira Code', monospace"
    ctx.textAlign = "left"
    ctx.fillText(fmtTime(samples[0].t), padL, H - 3)
    ctx.textAlign = "right"
    ctx.fillText(fmtTime(samples[n - 1].t), padL + cW, H - 3)
  }, [data])

  if (error && !data) {
    return (
      <div className="px-3 py-3">
        <p className="text-label text-muted-foreground">Water Clarity</p>
        <p className="text-caption text-muted-foreground/70 mt-1">unavailable</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="px-3 py-3">
        <p className="text-label text-muted-foreground">Water Clarity</p>
        <p className="text-caption text-muted-foreground/70 mt-1">loading…</p>
      </div>
    )
  }

  const samples = data.samples
  const enough  = samples.length >= 2
  const cur     = data.current.clarity
  const status  = data.current.flow_status ?? "ok"
  const min = enough ? Math.min(...samples.map((s) => s.clarity)) : null
  const max = enough ? Math.max(...samples.map((s) => s.clarity)) : null
  const lastT = enough ? samples[samples.length - 1].t : null

  return (
    <div className="px-3 py-3 space-y-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-label text-muted-foreground">Water Clarity</span>
          {cur != null && (
            <span className="text-caption font-mono text-foreground tabular-nums" data-value>
              {Math.round(cur * 100)}%
            </span>
          )}
        </div>
        <span className={`text-label px-1.5 py-0.5 rounded border ${FLOW_TEXT[status] ?? "border-border text-muted-foreground"}`}>
          {status}
        </span>
      </div>

      {!enough ? (
        <div className="h-20 rounded border border-border/40 flex items-center justify-center">
          <span className="text-caption text-muted-foreground/70">collecting samples…</span>
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} className="w-full h-20 rounded border border-border/40" />
          <div className="flex items-center justify-between text-label text-muted-foreground/70 tabular-nums">
            <span data-value>min {min !== null ? Math.round(min * 100) : "—"}% · max {max !== null ? Math.round(max * 100) : "—"}%</span>
            <span>{lastT ? fmtTime(lastT) : "—"}</span>
          </div>
        </>
      )}
    </div>
  )
}

// Re-export sample type for any consumer that wants it
export type { ClaritySample }
