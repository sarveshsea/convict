"use client"
import { useEffect, useRef, useState } from "react"
import { CANVAS_COLORS } from "@/lib/constants"
import type { Zone } from "@/lib/api"

interface Props {
  zoneTimeFractions: Record<string, number>
  zones: Zone[]
}

export function ZoneHeatmap({ zoneTimeFractions, zones }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const zonesRef = useRef<{ zone: Zone; x1: number; y1: number; x2: number; y2: number }[]>([])

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const W = rect.width, H = rect.height

    ctx.fillStyle = CANVAS_COLORS.bg
    ctx.fillRect(0, 0, W, H)

    if (zones.length === 0) {
      ctx.fillStyle = CANVAS_COLORS.text
      ctx.font = `10px 'Fira Code', monospace`
      ctx.textAlign = "center"
      ctx.fillText("no zones defined", W / 2, H / 2)
      return
    }

    const maxFrac = Math.max(...Object.values(zoneTimeFractions), 0.01)
    zonesRef.current = []

    for (const zone of zones) {
      const x1 = zone.x_min * W
      const y1 = zone.y_min * H
      const x2 = zone.x_max * W
      const y2 = zone.y_max * H
      const frac = zoneTimeFractions[zone.uuid] ?? 0
      zonesRef.current.push({ zone, x1, y1, x2, y2 })

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

      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`
      ctx.font = `9px 'Fira Code', monospace`
      ctx.textAlign = "left"
      ctx.fillText(zone.name, x1 + 4, y1 + 13)
      ctx.fillStyle = "rgba(255,255,255,0.6)"
      ctx.font = `8px 'Fira Code', monospace`
      ctx.fillText(`${(frac * 100).toFixed(0)}%`, x1 + 4, y1 + 24)
    }
  }

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [zoneTimeFractions, zones])

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = zonesRef.current.find(({ x1, y1, x2, y2 }) => mx >= x1 && mx <= x2 && my >= y1 && my <= y2)
    if (hit) {
      const frac = zoneTimeFractions[hit.zone.uuid] ?? 0
      setTooltip({
        x: mx,
        y: my,
        text: `${hit.zone.name} — ${(frac * 100).toFixed(1)}% of time`,
      })
    } else {
      setTooltip(null)
    }
  }

  // Zone visit frequency bars
  const sortedZones = [...zones].sort((a, b) => (zoneTimeFractions[b.uuid] ?? 0) - (zoneTimeFractions[a.uuid] ?? 0))
  const maxFrac = Math.max(...sortedZones.map((z) => zoneTimeFractions[z.uuid] ?? 0), 0.01)

  return (
    <div className="space-y-3" ref={containerRef}>
      <p className="text-label text-muted-foreground">Zone Time Distribution</p>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full h-52 rounded border border-border/40 bg-zinc-950"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-card border border-border rounded px-2 py-1 text-label text-foreground whitespace-nowrap z-10 shadow-lg"
            style={{ left: tooltip.x + 8, top: tooltip.y - 8 }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      {/* Zone frequency bar chart */}
      {sortedZones.length > 0 && Object.keys(zoneTimeFractions).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label text-muted-foreground">Zone Visit Frequency</p>
          {sortedZones.map((zone) => {
            const frac = zoneTimeFractions[zone.uuid] ?? 0
            return (
              <div key={zone.uuid} className="flex items-center gap-2">
                <span className="text-caption text-muted-foreground w-20 truncate shrink-0">{zone.name}</span>
                <div className="flex-1 h-px bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary opacity-70" style={{ width: `${(frac / maxFrac) * 100}%` }} />
                </div>
                <span className="text-label text-muted-foreground w-8 text-right shrink-0" data-value>
                  {(frac * 100).toFixed(0)}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {Object.keys(zoneTimeFractions).length === 0 && (
        <p className="text-caption text-muted-foreground text-center py-2">
          no baseline data yet — run pipeline for a few minutes
        </p>
      )}
    </div>
  )
}
