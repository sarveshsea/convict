"use client"
import { useEffect, useRef } from "react"
import { CANVAS_COLORS } from "@/lib/constants"
import { EmptyState } from "@/components/ui/empty-state"
import type { ConfidencePoint } from "@/lib/api"

interface Props { history: ConfidencePoint[] }

export function SpeedHistoryChart({ history }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  function draw() {
    const canvas = canvasRef.current
    if (!canvas || history.length === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const W = rect.width, H = rect.height
    const padL = 32, padR = 8, padT = 8, padB = 18
    const cW = W - padL - padR
    const cH = H - padT - padB

    ctx.fillStyle = CANVAS_COLORS.bg
    ctx.fillRect(0, 0, W, H)

    const speeds = history.map((h) => h.mean_speed)
    const maxVal = Math.max(...speeds, 0.1)
    const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length

    // Grid lines + Y-axis labels (actual speed values)
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const y     = padT + cH * (1 - i / steps)
      const label = ((maxVal * i) / steps).toFixed(1)
      ctx.strokeStyle = CANVAS_COLORS.grid
      ctx.lineWidth   = 0.5
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke()
      ctx.fillStyle = CANVAS_COLORS.text
      ctx.font      = `7px 'Fira Code', monospace`
      ctx.textAlign = "right"
      ctx.fillText(label, padL - 3, y + 3)
    }

    const n     = history.length
    const stepX = n > 1 ? cW / (n - 1) : cW

    // Mean reference line
    if (n > 1) {
      const meanY = padT + cH * (1 - meanSpeed / maxVal)
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = CANVAS_COLORS.muted
      ctx.lineWidth   = 1
      ctx.beginPath(); ctx.moveTo(padL, meanY); ctx.lineTo(padL + cW, meanY); ctx.stroke()
      ctx.restore()
    }

    if (n < 2) return

    const points = speeds.map((v, i) => ({
      x: padL + i * stepX,
      y: padT + cH * (1 - v / maxVal),
    }))

    // Area fill
    ctx.beginPath()
    ctx.moveTo(points[0].x, padT + cH)
    points.forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[n - 1].x, padT + cH)
    ctx.closePath()
    ctx.fillStyle = CANVAS_COLORS.fill
    ctx.fill()

    // Line
    ctx.beginPath()
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = CANVAS_COLORS.primary
    ctx.lineWidth   = 1.5
    ctx.stroke()
  }

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [history])

  if (history.length === 0) {
    return <EmptyState message="no speed history yet" height="lg" />
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <p className="text-label text-muted-foreground">Speed History (px/frame)</p>
      <canvas
        ref={canvasRef}
        className="w-full h-24 rounded border border-border/40"
      />
      <p className="text-label text-muted-foreground" data-value>
        {history.length} baseline snapshot{history.length !== 1 ? "s" : ""} · dashed line = mean
      </p>
    </div>
  )
}

// Keep old export name as alias for the drilldown page which imports it
export { SpeedHistoryChart as IdentityConfidenceChart }
