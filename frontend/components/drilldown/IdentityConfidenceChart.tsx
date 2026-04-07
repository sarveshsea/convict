"use client"
import { useEffect, useRef } from "react"
import type { ConfidencePoint } from "@/lib/api"

interface Props { history: ConfidencePoint[] }

export function IdentityConfidenceChart({ history }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || history.length === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W  = canvas.width
    const H  = canvas.height
    const padL = 28, padR = 8, padT = 8, padB = 16
    const cW = W - padL - padR
    const cH = H - padT - padB

    ctx.fillStyle = "#0d0d10"
    ctx.fillRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = "rgba(63,63,70,0.5)"
    ctx.lineWidth   = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = padT + (cH * (1 - i / 4))
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + cW, y)
      ctx.stroke()
      ctx.fillStyle = "#52525b"
      ctx.font = "7px 'Fira Code', monospace"
      ctx.textAlign = "right"
      ctx.fillText(`${(i * 25)}%`, padL - 3, y + 3)
    }

    // Use mean_speed as a proxy for observation density (no per-frame confidence stored in DB)
    const values = history.map((h) => Math.min(h.mean_speed / 10, 1))  // normalise
    const n      = values.length
    if (n < 2) return

    const stepX = cW / (n - 1)

    // Area fill
    ctx.beginPath()
    ctx.moveTo(padL, padT + cH)
    values.forEach((v, i) => {
      const x = padL + i * stepX
      const y = padT + cH * (1 - v)
      i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(padL + (n - 1) * stepX, padT + cH)
    ctx.closePath()
    ctx.fillStyle = "rgba(96, 165, 250, 0.10)"
    ctx.fill()

    // Line
    ctx.beginPath()
    values.forEach((v, i) => {
      const x = padL + i * stepX
      const y = padT + cH * (1 - v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = "rgba(96, 165, 250, 0.85)"
    ctx.lineWidth   = 1.5
    ctx.stroke()

  }, [history])

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[10px] font-mono text-muted-foreground">
        no observation history yet
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
        Observation Activity (baseline snapshots)
      </p>
      <canvas
        ref={canvasRef}
        width={400}
        height={100}
        className="w-full rounded border border-border/40"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="text-[8px] font-mono text-muted-foreground">
        {history.length} baseline snapshot{history.length !== 1 ? "s" : ""} recorded
      </p>
    </div>
  )
}
