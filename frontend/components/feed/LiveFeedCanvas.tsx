"use client"
import { useEffect, useRef, useState } from "react"
import { STREAM_URL, STREAM_URL_2 } from "@/lib/constants"
import { useObservationStore } from "@/store/observationStore"
import type { LiveEntity } from "@/store/observationStore"

function confidenceColor(c: number): string {
  if (c >= 0.7) return "#34d399"
  if (c >= 0.4) return "#fbbf24"
  return "#f43f5e"
}

/** Extract the common name from "Binomial name (Common Name)" or return first two words */
function extractCommonName(species: string): string {
  const m = species.match(/\(([^)]+)\)/)
  if (m) return m[1]
  const words = species.split(" ")
  return words.slice(0, 2).join(" ")
}

type ChipState = { text: string; color: string; scanning: boolean }

function getChipState(identity: LiveEntity["identity"]): ChipState {
  const conf = identity?.confidence ?? 0
  const species = identity?.species

  if (!species || species === "Unknown" || species === "") {
    return { text: "identifying", color: "#71717a", scanning: true }
  }
  if (species.startsWith("Possible: ")) {
    const common = extractCommonName(species.slice("Possible: ".length))
    return { text: `~ ${common}`, color: "#fbbf24", scanning: false }
  }
  const common = extractCommonName(species)
  const color = conf >= 0.7 ? "#34d399" : conf >= 0.4 ? "#fbbf24" : "#71717a"
  return { text: common, color, scanning: false }
}

interface Letterbox {
  renderW: number; renderH: number
  offX: number;    offY: number
  cw: number;      ch: number
  scaleX: number;  scaleY: number
}

function drawEntity(ctx: CanvasRenderingContext2D, e: LiveEntity, lb: Letterbox) {
  const { offX, offY, scaleX, scaleY, cw, ch } = lb

  const rx1 = Math.max(0, Math.min(cw, e.bbox[0] * scaleX + offX))
  const ry1 = Math.max(0, Math.min(ch, e.bbox[1] * scaleY + offY))
  const rx2 = Math.max(0, Math.min(cw, e.bbox[2] * scaleX + offX))
  const ry2 = Math.max(0, Math.min(ch, e.bbox[3] * scaleY + offY))
  if (rx2 - rx1 < 2 || ry2 - ry1 < 2) return

  const chipMeta = getChipState(e.identity)
  const color = chipMeta.scanning ? "#52525b" : chipMeta.color
  const bw    = rx2 - rx1
  const bh    = ry2 - ry1
  const clen  = Math.max(8, Math.min(bw * 0.2, bh * 0.2, 20))

  ctx.strokeStyle = color
  ctx.lineWidth   = 2
  ctx.globalAlpha = 0.95
  ctx.lineCap     = "square"
  for (const [px, py, sx, sy] of [
    [rx1, ry1,  1,  1], [rx2, ry1, -1,  1],
    [rx1, ry2,  1, -1], [rx2, ry2, -1, -1],
  ] as [number, number, number, number][]) {
    ctx.beginPath()
    ctx.moveTo(px + sx * clen, py)
    ctx.lineTo(px, py)
    ctx.lineTo(px, py + sy * clen)
    ctx.stroke()
  }

  if (e.trail.length > 1) {
    const n = e.trail.length
    for (let j = 1; j < n; j++) {
      const a   = (j / n) * 0.65
      const px0 = Math.max(0, Math.min(cw, e.trail[j - 1][0] * scaleX + offX))
      const py0 = Math.max(0, Math.min(ch, e.trail[j - 1][1] * scaleY + offY))
      const px1 = Math.max(0, Math.min(cw, e.trail[j][0] * scaleX + offX))
      const py1 = Math.max(0, Math.min(ch, e.trail[j][1] * scaleY + offY))
      ctx.beginPath()
      ctx.strokeStyle  = color
      ctx.lineWidth    = 1.5
      ctx.globalAlpha  = a
      ctx.moveTo(px0, py0)
      ctx.lineTo(px1, py1)
      ctx.stroke()
    }
  }

  ctx.beginPath()
  ctx.arc((rx1 + rx2) / 2, (ry1 + ry2) / 2, 3, 0, Math.PI * 2)
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.85
  ctx.fill()

  ctx.globalAlpha = 1
  const chip = getChipState(e.identity)
  const conf = e.identity?.confidence ?? 0
  const confStr = e.identity?.fish_id ? ` ${(conf * 100).toFixed(0)}%` : ""

  if (chip.scanning) {
    const phase = Math.floor(Date.now() / 350) % 3
    const dotLabel = "identifying" + ".".repeat(phase + 1)
    ctx.font = "10px 'Geist Mono', monospace"
    const tw    = ctx.measureText(dotLabel).width
    const chipX = rx1
    const chipY = Math.max(0, ry1 - 18)
    ctx.fillStyle = "rgba(9,9,11,0.70)"
    ctx.fillRect(chipX, chipY, tw + 10, 16)
    ctx.fillStyle = chip.color
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 600))
    ctx.fillText(dotLabel, chipX + 5, chipY + 11)
    ctx.globalAlpha = 1
  } else {
    const label = `${chip.text}${confStr}`
    ctx.font = "bold 11px 'Geist Mono', monospace"
    const tw    = ctx.measureText(label).width
    const chipX = rx1
    const chipY = Math.max(0, ry1 - 18)
    ctx.fillStyle = "rgba(9,9,11,0.82)"
    ctx.fillRect(chipX, chipY, tw + 10, 16)
    ctx.fillStyle = chip.color
    ctx.fillText(label, chipX + 5, chipY + 11)
  }
}

function getCoverBox(fw: number, fh: number, cw: number, ch: number): Letterbox {
  const imgAspect = fw / fh
  const boxAspect = cw / ch
  let renderW: number, renderH: number

  if (boxAspect > imgAspect) {
    renderH = ch
    renderW = ch * imgAspect
  } else {
    renderW = cw
    renderH = cw / imgAspect
  }
  const offX = (cw - renderW) / 2
  const offY = (ch - renderH) / 2

  return {
    renderW, renderH, offX, offY, cw, ch,
    scaleX: renderW / fw,
    scaleY: renderH / fh,
  }
}

// Single camera pane — handles its own img + optional overlay canvas
function CameraPane({
  src,
  label,
  entities,
  frameWidth,
  frameHeight,
  nightMode,
}: {
  src: string
  label: string
  entities: LiveEntity[]
  frameWidth: number
  frameHeight: number
  nightMode: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const [streamOk, setStreamOk] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const sync = () => {
      canvas.width        = container.clientWidth
      canvas.height       = container.clientHeight
      canvas.style.width  = container.clientWidth  + "px"
      canvas.style.height = container.clientHeight + "px"
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas    = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (entities.length === 0) return
    const lb = getCoverBox(frameWidth, frameHeight, container.clientWidth, container.clientHeight)
    entities.forEach((e) => drawEntity(ctx, e, lb))
  }, [entities, frameWidth, frameHeight])

  return (
    <div ref={containerRef} className="relative flex-1 bg-zinc-950 overflow-hidden">
      <img
        key={src}
        src={src}
        alt={label}
        className="absolute inset-0 w-full h-full object-contain"
        onLoad={() => setStreamOk(true)}
        onError={() => {
          setStreamOk(false)
          // retry after 2s — backend may still be warming up
          setTimeout(() => setStreamOk(true), 2000)
        }}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ imageRendering: "crisp-edges" }}
      />

      {/* Camera label badge */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900/80 border border-zinc-700/50">
        <div className={`w-1.5 h-1.5 rounded-full ${streamOk ? "bg-emerald-400" : "bg-zinc-600"}`} />
        <span className="text-[9px] font-mono text-zinc-300 uppercase tracking-widest">{label}</span>
      </div>

      {nightMode && streamOk && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900/80 border border-zinc-700/50">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span className="text-[9px] font-mono text-indigo-300 uppercase tracking-widest">Night</span>
        </div>
      )}

      {!streamOk && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Camera offline
          </span>
          <span className="text-[9px] font-mono text-zinc-600">
            {label}
          </span>
        </div>
      )}
    </div>
  )
}

export function LiveFeedCanvas() {
  const entities        = useObservationStore((s) => s.entities)
  const frameWidth      = useObservationStore((s) => s.frameWidth)
  const frameHeight     = useObservationStore((s) => s.frameHeight)
  const nightMode       = useObservationStore((s) => s.nightMode)
  const cam2Active      = useObservationStore((s) => s.pipeline.cam2_active)
  const cam2Entities    = useObservationStore((s) => s.cam2Entities)
  const cam2FrameWidth  = useObservationStore((s) => s.cam2FrameWidth)
  const cam2FrameHeight = useObservationStore((s) => s.cam2FrameHeight)

  return (
    <div className="absolute inset-0 flex">
      {/* Cam 1 — annotated detection feed */}
      <CameraPane
        src={STREAM_URL}
        label="CAM 1"
        entities={entities}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        nightMode={nightMode}
      />

      {/* Cam 2 — only shown when backend confirms it's streaming */}
      {cam2Active && (
        <>
          <div className="w-px bg-zinc-800 flex-shrink-0" />
          <CameraPane
            src={STREAM_URL_2}
            label="CAM 2"
            entities={cam2Entities}
            frameWidth={cam2FrameWidth}
            frameHeight={cam2FrameHeight}
            nightMode={nightMode}
          />
        </>
      )}
    </div>
  )
}
