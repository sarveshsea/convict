"use client"
import { useEffect, useRef } from "react"
import type { Zone } from "@/lib/api"

interface Props {
  zoneTimeFractions: Record<string, number>
  zones: Zone[]
}

export function ZoneHeatmap({ zoneTimeFractions, zones }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height

    // Background
    ctx.fillStyle = "#0d0d10"
    ctx.fillRect(0, 0, W, H)

    if (zones.length === 0) {
      ctx.fillStyle = "#52525b"
      ctx.font = "10px 'Fira Code', monospace"
      ctx.textAlign = "center"
      ctx.fillText("no zones defined", W / 2, H / 2)
      return
    }

    const maxFrac = Math.max(...Object.values(zoneTimeFractions), 0.01)

    for (const zone of zones) {
      const x1 = zone.x_min * W
      const y1 = zone.y_min * H
      const x2 = zone.x_max * W
      const y2 = zone.y_max * H
      const frac = zoneTimeFractions[zone.uuid] ?? 0

      // Heatmap colour: cold blue → warm amber → hot rose
      const t = frac / maxFrac
      let r, g, b
      if (t < 0.5) {
        r = Math.round(30  + t * 2 * (251 - 30))
        g = Math.round(100 + t * 2 * (191 - 100))
        b = Math.round(200 + t * 2 * (36  - 200))
      } else {
        r = Math.round(251 + (t - 0.5) * 2 * (244 - 251))
        g = Math.round(191 + (t - 0.5) * 2 * (63  - 191))
        b = Math.round(36  + (t - 0.5) * 2 * (94  - 36))
      }

      ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + t * 0.65})`
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1)

      ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`
      ctx.lineWidth = 1
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

      // Label
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`
      ctx.font = "9px 'Fira Code', monospace"
      ctx.textAlign = "left"
      ctx.fillText(zone.name, x1 + 4, y1 + 13)
      ctx.fillStyle = "rgba(255,255,255,0.6)"
      ctx.font = "8px 'Fira Code', monospace"
      ctx.fillText(`${(frac * 100).toFixed(0)}%`, x1 + 4, y1 + 24)
    }
  }, [zoneTimeFractions, zones])

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
        Zone Time Distribution
      </p>
      <canvas
        ref={canvasRef}
        width={400}
        height={240}
        className="w-full rounded border border-border/40 bg-zinc-950"
        style={{ imageRendering: "pixelated" }}
      />
      {Object.keys(zoneTimeFractions).length === 0 && (
        <p className="text-[10px] font-mono text-muted-foreground text-center py-4">
          no baseline data yet — run pipeline for a few minutes
        </p>
      )}
    </div>
  )
}
