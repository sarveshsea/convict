"use client"
import { useEffect, useRef, useState } from "react"
import { getFeedingResponse, type FeedingResponseData } from "@/lib/api"
import { CANVAS_COLORS } from "@/lib/constants"
import { EmptyState } from "@/components/ui/empty-state"

interface Props {
  fishUuid: string
}

export function FeedingResponse({ fishUuid }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data, setData]       = useState<FeedingResponseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getFeedingResponse(fishUuid, 7)
      .then((r) => { if (!cancelled) setData(r) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fishUuid])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.buckets.length === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = rect.width, H = rect.height
    const padL = 36, padR = 12, padT = 14, padB = 22
    const cW = W - padL - padR
    const cH = H - padT - padB

    ctx.fillStyle = CANVAS_COLORS.bg
    ctx.fillRect(0, 0, W, H)

    const buckets = data.buckets
    const speeds = buckets.map((b) => b.mean_speed)
    const baseline = data.baseline_speed
    const allVals = baseline !== null ? [...speeds, baseline] : speeds
    const maxVal = Math.max(...allVals, 0.1)
    const minVal = 0
    const range = Math.max(maxVal - minVal, 0.05)

    // X scale: -30 .. +30
    const xMin = -30, xMax = 30
    const xRange = xMax - xMin
    const xPx = (off: number) => padL + ((off - xMin) / xRange) * cW
    const yPx = (v: number) => padT + cH * (1 - (v - minVal) / range)

    // Y grid
    const ySteps = 4
    for (let i = 0; i <= ySteps; i++) {
      const y = padT + cH * (1 - i / ySteps)
      const label = (minVal + (range * i) / ySteps).toFixed(2)
      ctx.strokeStyle = CANVAS_COLORS.grid
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke()
      ctx.fillStyle = CANVAS_COLORS.text
      ctx.font = "8px 'Fira Code', monospace"
      ctx.textAlign = "right"
      ctx.fillText(label, padL - 3, y + 3)
    }

    // X ticks every 10 minutes
    ctx.fillStyle = CANVAS_COLORS.text
    ctx.font = "8px 'Fira Code', monospace"
    ctx.textAlign = "center"
    for (let off = xMin; off <= xMax; off += 10) {
      const x = xPx(off)
      ctx.strokeStyle = CANVAS_COLORS.grid
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + cH); ctx.stroke()
      const sign = off > 0 ? "+" : ""
      ctx.fillStyle = CANVAS_COLORS.text
      ctx.fillText(`${sign}${off}`, x, padT + cH + 11)
    }
    // Axis title
    ctx.fillStyle = CANVAS_COLORS.text
    ctx.font = "8px 'Fira Code', monospace"
    ctx.textAlign = "center"
    ctx.fillText("minutes from feed", padL + cW / 2, padT + cH + 20)

    // Baseline dashed line
    if (baseline !== null) {
      const by = yPx(baseline)
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = "rgba(161,161,170,0.8)"
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padL, by); ctx.lineTo(padL + cW, by); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = "rgba(161,161,170,0.9)"
      ctx.font = "8px 'Fira Code', monospace"
      ctx.textAlign = "left"
      ctx.fillText("baseline", padL + 3, by - 3)
    }

    // Vertical "feed" line at offset 0
    const fx = xPx(0)
    ctx.save()
    ctx.strokeStyle = "rgba(96,165,250,0.85)"
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.moveTo(fx, padT); ctx.lineTo(fx, padT + cH); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = "rgba(96,165,250,0.95)"
    ctx.font = "8px 'Fira Code', monospace"
    ctx.textAlign = "center"
    ctx.fillText("feed", fx, padT - 3)

    // Speed line
    const points = buckets.map((b) => ({ x: xPx(b.minutes_offset), y: yPx(b.mean_speed) }))
    if (points.length >= 2) {
      ctx.beginPath()
      points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = CANVAS_COLORS.primary
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
    // Points
    for (const p of points) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = CANVAS_COLORS.primary
      ctx.fill()
    }
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-caption text-muted-foreground">loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-caption text-rose-400">{error}</p>
      </div>
    )
  }

  if (!data || data.buckets.length === 0) {
    return (
      <div className="space-y-1">
        <EmptyState message="no feeding events recorded yet" height="lg" />
        <p className="text-label text-muted-foreground/60 text-center">schedule a feeding to start collecting data</p>
      </div>
    )
  }

  const totalSamples = data.buckets.reduce((a, b) => a + b.n, 0)

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <p className="text-label text-muted-foreground">Feeding Response (last {data.days}d)</p>
        <span className="text-label text-muted-foreground tabular-nums" data-value>{totalSamples} samples</span>
      </div>
      <canvas ref={canvasRef} className="w-full h-48 rounded border border-border/40" />
      {data.baseline_speed !== null && (
        <p className="text-label text-muted-foreground/70 tabular-nums">
          baseline {data.baseline_speed.toFixed(2)} px/frame · {data.buckets.length} buckets
        </p>
      )}
    </div>
  )
}
