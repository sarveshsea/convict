"use client"
import { useEffect, useRef } from "react"

interface BaselineData {
  mean_speed_px_per_frame: number
  speed_stddev: number
  activity_by_hour: Record<string, number>
  observation_frame_count: number
}

interface Props { baseline: BaselineData | null }

export function BehaviorBaseline({ baseline }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !baseline) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = "#0d0d10"
    ctx.fillRect(0, 0, W, H)

    // 24-hour activity bar chart
    const byHour = baseline.activity_by_hour
    const hours = Array.from({ length: 24 }, (_, i) => Number(byHour[i] ?? 0))
    const maxVal = Math.max(...hours, 1)

    const barW  = Math.floor(W / 24)
    const padB  = 20
    const chartH = H - padB - 4

    for (let i = 0; i < 24; i++) {
      const barH  = Math.max(1, (hours[i] / maxVal) * chartH)
      const x     = i * barW
      const y     = H - padB - barH

      // Highlight active hours
      const t = hours[i] / maxVal
      const alpha = 0.3 + t * 0.7
      ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`   // blue-400
      ctx.fillRect(x + 1, y, barW - 2, barH)
    }

    // Hour labels every 6h
    ctx.fillStyle = "#52525b"
    ctx.font = "8px 'Fira Code', monospace"
    ctx.textAlign = "center"
    for (const h of [0, 6, 12, 18, 23]) {
      ctx.fillText(String(h), h * barW + barW / 2, H - 6)
    }
  }, [baseline])

  if (!baseline) {
    return (
      <div className="flex items-center justify-center h-24 text-[10px] font-mono text-muted-foreground">
        no baseline computed yet
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
        Behavioral Baseline
      </p>

      {/* Speed stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Mean Speed",  value: `${baseline.mean_speed_px_per_frame.toFixed(1)} px/f` },
          { label: "Std Dev",     value: `±${baseline.speed_stddev.toFixed(1)}` },
          { label: "Obs Frames",  value: baseline.observation_frame_count.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="px-2 py-1.5 rounded border border-border/30 bg-surface">
            <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-widest">{label}</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Activity by hour chart */}
      <div>
        <p className="text-[9px] font-mono text-muted-foreground mb-1">Activity by Hour (UTC)</p>
        <canvas
          ref={canvasRef}
          width={400}
          height={80}
          className="w-full rounded border border-border/40"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    </div>
  )
}
