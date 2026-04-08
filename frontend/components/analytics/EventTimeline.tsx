"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { listEvents } from "@/lib/api"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"
import { useUIStore } from "@/store/uiStore"
import type { BehaviorEvent, KnownFish } from "@/lib/api"
import type { AnomalyItem } from "@/store/predictionStore"

// ── Types ─────────────────────────────────────────────────────────────────────

type ZoomLevel = "1h" | "6h" | "24h" | "7d"

const ZOOM_MS: Record<ZoomLevel, number> = {
  "1h":  1 * 3600_000,
  "6h":  6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d":  7 * 24 * 3600_000,
}

const LANE_H    = 36
const LABEL_W   = 104
const TIMELINE_W = 2400
const PAD_T     = 8
const PAD_B     = 28
const DOT_R     = 5

const EVENT_COLOR: Record<string, string> = {
  harassment:   "#f43f5e",
  chase:        "#fb7185",
  hiding:       "#fbbf24",
  missing_fish: "#f43f5e",
  lethargy:     "#fbbf24",
  schooling:    "#34d399",
  dispersion:   "#71717a",
  vlm_observation: "#60a5fa",
}

const SEVERITY_COLOR: Record<string, string> = {
  high:   "#f43f5e",
  medium: "#fbbf24",
  low:    "#71717a",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function anomalyToEvent(a: AnomalyItem): BehaviorEvent {
  return {
    uuid:             a.uuid,
    event_type:       a.event_type,
    severity:         a.severity,
    occurred_at:      a.started_at,
    involved_fish:    a.involved_fish,
    zone_id:          a.zone_id,
    duration_seconds: null,
    notes:            a.description,
  }
}

function timeX(t: number, minT: number, maxT: number, areaW: number): number {
  return LABEL_W + ((t - minT) / (maxT - minT)) * areaW
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function timeSince(occurred: string): string {
  const ms = Date.now() - new Date(occurred).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

interface HitEvent {
  event: BehaviorEvent
  x: number; y: number
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  lanes: { fish: KnownFish | null; label: string; events: BehaviorEvent[] }[],
  now: number,
  zoomMs: number,
  W: number,
  H: number,
  hovered: HitEvent | null,
  hitMap: React.MutableRefObject<HitEvent[]>,
) {
  const minT   = now - zoomMs
  const maxT   = now
  const areaW  = W - LABEL_W

  ctx.fillStyle = "#09090f"
  ctx.fillRect(0, 0, W, H)

  hitMap.current = []

  // Time grid lines + labels
  const gridSteps = 6
  for (let i = 0; i <= gridSteps; i++) {
    const t  = minT + (i / gridSteps) * (maxT - minT)
    const x  = timeX(t, minT, maxT, areaW)
    ctx.strokeStyle = "rgba(63,63,70,0.35)"
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - PAD_B); ctx.stroke()
    ctx.fillStyle = "rgba(113,113,122,0.65)"
    ctx.font = "8px 'Fira Code', monospace"
    ctx.textAlign = "center"
    const label = zoomMs > 24 * 3600_000
      ? `${formatDate(t)} ${formatTime(t)}`
      : formatTime(t)
    ctx.fillText(label, x, H - PAD_B + 14)
  }

  // "Now" marker
  ctx.strokeStyle = "rgba(96,165,250,0.45)"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath(); ctx.moveTo(W - 1, 0); ctx.lineTo(W - 1, H - PAD_B); ctx.stroke()
  ctx.setLineDash([])

  // Swim lanes
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li]
    const laneY = PAD_T + li * LANE_H

    // Alternating row background
    ctx.fillStyle = li % 2 === 0 ? "rgba(24,24,27,0.40)" : "rgba(9,9,15,0.40)"
    ctx.fillRect(0, laneY, W, LANE_H)

    // Label area
    ctx.fillStyle = "rgba(15,15,20,0.75)"
    ctx.fillRect(0, laneY, LABEL_W - 4, LANE_H)
    ctx.fillStyle = li === 0 ? "rgba(228,228,231,0.70)" : "rgba(161,161,170,0.70)"
    ctx.font = li === 0 ? "bold 9px 'Fira Code', monospace" : "9px 'Fira Code', monospace"
    ctx.textAlign = "left"
    ctx.fillText(
      lane.label.length > 12 ? lane.label.slice(0, 11) + "…" : lane.label,
      6, laneY + LANE_H / 2 + 3.5,
    )

    // Divider
    ctx.strokeStyle = "rgba(63,63,70,0.35)"
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, laneY + LANE_H); ctx.lineTo(W, laneY + LANE_H); ctx.stroke()

    // Events
    for (const ev of lane.events) {
      const t = new Date(ev.occurred_at).getTime()
      if (t < minT || t > maxT) continue
      const x    = timeX(t, minT, maxT, areaW)
      const y    = laneY + LANE_H / 2
      const color = EVENT_COLOR[ev.event_type] ?? "#71717a"
      const isHov = hovered?.event.uuid === ev.uuid

      hitMap.current.push({ event: ev, x, y })

      ctx.save()
      if (isHov) { ctx.shadowColor = color; ctx.shadowBlur = 12 }
      ctx.beginPath()
      ctx.arc(x, y, isHov ? DOT_R + 2 : DOT_R, 0, Math.PI * 2)
      ctx.fillStyle   = color
      ctx.globalAlpha = isHov ? 1 : 0.75
      ctx.fill()
      if (isHov) {
        ctx.beginPath()
        ctx.arc(x, y, DOT_R + 5, 0, Math.PI * 2)
        ctx.strokeStyle = color
        ctx.lineWidth   = 1.5
        ctx.globalAlpha = 0.35
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // Left label column separator
  ctx.strokeStyle = "rgba(63,63,70,0.5)"
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(LABEL_W - 4, 0); ctx.lineTo(LABEL_W - 4, H - PAD_B); ctx.stroke()
}

// ── Main component ────────────────────────────────────────────────────────────

export function EventTimeline() {
  const { openFishModal } = useUIStore()
  const fish              = useTankStore((s) => s.fish).filter((f) => f.is_active)
  const liveAnomalies = usePredictionStore((s) => s.anomalies)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hitMapRef    = useRef<HitEvent[]>([])
  const boxRef       = useRef({ w: 0, h: 0 })
  const hoveredRef   = useRef<HitEvent | null>(null)

  const [events,  setEvents]  = useState<BehaviorEvent[]>([])
  const [zoom,    setZoom]    = useState<ZoomLevel>("24h")
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<HitEvent | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)

  // Load + merge with live anomalies
  useEffect(() => {
    listEvents(200).then((loaded) => {
      setEvents(loaded)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const allEvents = [
    ...events,
    ...liveAnomalies.map(anomalyToEvent).filter(
      (a) => !events.some((e) => e.uuid === a.uuid),
    ),
  ]

  // Build lanes: "All" first, then one per fish
  const allLane = { fish: null as KnownFish | null, label: "All fish", events: allEvents }
  const fishLanes = fish.map((f) => ({
    fish: f,
    label: f.name,
    events: allEvents.filter((ev) =>
      ev.involved_fish.some((i) => i.fish_id === f.uuid),
    ),
  }))
  const lanes = [allLane, ...fishLanes]
  const totalH = PAD_T + lanes.length * LANE_H + PAD_B

  // Canvas sizing
  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const sync = () => {
      const cw  = container.clientWidth
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(cw * dpr)
      canvas.height = Math.round(totalH * dpr)
      canvas.style.width  = `${cw}px`
      canvas.style.height = `${totalH}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      boxRef.current = { w: cw, h: totalH }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [totalH])

  // Redraw whenever data or state changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { w } = boxRef.current
    if (w < 1) return
    drawTimeline(ctx, lanes, Date.now(), ZOOM_MS[zoom], w, totalH, hoveredRef.current, hitMapRef)
  }, [allEvents.length, zoom, totalH, hovered])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top + (canvas.parentElement?.scrollTop ?? 0)
    const hit  = hitMapRef.current.find(
      (h) => Math.hypot(h.x - mx, h.y - my) <= DOT_R + 6,
    ) ?? null
    hoveredRef.current = hit
    setHovered(hit)
    if (hit) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    else     setTooltip(null)
  }, [])

  const onClick = useCallback(() => {
    const hit = hoveredRef.current
    if (!hit) return
    const primary = hit.event.involved_fish?.[0]?.fish_id
    if (primary) openFishModal(primary)
  }, [openFishModal])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border/40 shrink-0">
        <span className="text-label text-muted-foreground">Zoom</span>
        <div className="flex gap-0.5">
          {(["1h", "6h", "24h", "7d"] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`text-label px-2 py-1 rounded transition-colors ${
                zoom === z
                  ? "text-primary bg-primary/10 border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          {Object.entries(EVENT_COLOR).slice(0, 5).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-label" style={{ color }}>{type.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable canvas area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin overflow-x-hidden min-h-0 relative" ref={containerRef}>
        {loading ? (
          <div className="flex items-center justify-center h-32 text-caption text-muted-foreground">
            loading events…
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full block"
            onMouseMove={onMouseMove}
            onMouseLeave={() => {
              hoveredRef.current = null
              setHovered(null)
              setTooltip(null)
            }}
            onClick={onClick}
            style={{ cursor: hovered ? "pointer" : "default" }}
          />
        )}

        {/* Hover tooltip */}
        {hovered && tooltip && (
          <div
            className="absolute pointer-events-none bg-zinc-950/95 border border-border/50 rounded p-2.5 space-y-1 z-20 shadow-xl min-w-44"
            style={{
              left: Math.min(tooltip.x + 12, (boxRef.current.w || 400) - 200),
              top:  tooltip.y + 12,
            }}
          >
            <p className="text-detail font-medium" style={{ color: EVENT_COLOR[hovered.event.event_type] ?? "#e4e4e7" }}>
              {hovered.event.event_type.replace("_", " ")}
            </p>
            <p className="text-label text-muted-foreground">{timeSince(hovered.event.occurred_at)}</p>
            {hovered.event.involved_fish.length > 0 && (
              <p className="text-caption text-muted-foreground">
                {hovered.event.involved_fish.map((f) => f.fish_name).join(", ")}
              </p>
            )}
            {hovered.event.notes && (
              <p className="text-label text-muted-foreground mt-1">{hovered.event.notes}</p>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: SEVERITY_COLOR[hovered.event.severity] ?? "#71717a" }}
              />
              <span className="text-label" style={{ color: SEVERITY_COLOR[hovered.event.severity] }}>
                {hovered.event.severity}
              </span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && allEvents.length === 0 && (
          <div className="flex items-center justify-center h-32 text-caption text-muted-foreground">
            no events recorded yet — run the pipeline for a while
          </div>
        )}
      </div>
    </div>
  )
}
