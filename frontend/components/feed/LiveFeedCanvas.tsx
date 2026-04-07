"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { STREAM_URL, STREAM_URL_2, fishSnapshotUrl } from "@/lib/constants"
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

function labelForEntity(e: LiveEntity): string {
  const id = e.identity
  if (id?.fish_name?.trim()) return id.fish_name.trim()
  if (id?.species && id.species !== "Unknown") return extractCommonName(id.species)
  return "Fish"
}

function FishThumbnailStrip({
  entities,
  frameSeq,
}: {
  entities: LiveEntity[]
  frameSeq: number
}) {
  const items = useMemo(() => {
    const best = new Map<string, { fishId: string; label: string; conf: number }>()
    for (const e of entities) {
      const fid = e.identity?.fish_id
      if (!fid) continue
      const conf = e.identity?.confidence ?? 0
      if (conf < 0.42) continue
      const label = labelForEntity(e)
      const prev = best.get(fid)
      if (!prev || conf > prev.conf) best.set(fid, { fishId: fid, label, conf })
    }
    return Array.from(best.values())
      .sort((a, b) => a.conf - b.conf)
      .slice(-6)
  }, [entities])

  if (items.length === 0) return null

  return (
    <div className="absolute bottom-3 right-3 z-20 flex max-h-[min(55vh,420px)] flex-col justify-end gap-2 pointer-events-none">
      {items.map(({ fishId, label, conf }) => (
        <FishThumb key={fishId} fishId={fishId} label={label} conf={conf} frameSeq={frameSeq} />
      ))}
    </div>
  )
}

function FishThumb({
  fishId,
  label,
  conf,
  frameSeq,
}: {
  fishId: string
  label: string
  conf: number
  frameSeq: number
}) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/12 bg-zinc-950/85 py-1.5 pl-1.5 pr-2.5 shadow-xl shadow-black/50 ring-1 ring-white/8 backdrop-blur-md">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-white/10">
        {imgOk ? (
          <img
            src={fishSnapshotUrl(fishId, frameSeq)}
            alt={label}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-sm font-semibold text-zinc-400">
            {label.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold leading-tight text-zinc-100">{label}</p>
        <p className="font-mono text-[10px] tabular-nums text-emerald-400/90">{(conf * 100).toFixed(0)}% match</p>
      </div>
    </div>
  )
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
  frameSeq,
  nightMode,
  pipelineActive,
}: {
  src: string
  label: string
  entities: LiveEntity[]
  frameWidth: number
  frameHeight: number
  frameSeq: number
  nightMode: boolean
  pipelineActive: boolean
}) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const retryTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay    = useRef(2000)
  const [streamOk, setStreamOk] = useState(true)
  const [box, setBox] = useState({ w: 0, h: 0 })

  // When pipeline comes back online, reset backoff and immediately try the stream
  useEffect(() => {
    if (pipelineActive && !streamOk) {
      retryDelay.current = 2000
      setStreamOk(true)
    }
  }, [pipelineActive])

  function scheduleRetry() {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(() => {
      setStreamOk(true)
      retryDelay.current = Math.min(retryDelay.current * 2, 16000)
    }, retryDelay.current)
  }

  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current) }, [])

  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const sync = () => {
      const cw = container.clientWidth
      const ch = container.clientHeight
      setBox({ w: cw, h: ch })
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
      canvas.width = Math.max(1, Math.round(cw * dpr))
      canvas.height = Math.max(1, Math.round(ch * dpr))
      canvas.style.width = `${cw}px`
      canvas.style.height = `${ch}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || box.w < 1 || box.h < 1) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box.w, box.h)
    if (entities.length === 0) return
    const lb = getCoverBox(frameWidth, frameHeight, box.w, box.h)
    entities.forEach((e) => drawEntity(ctx, e, lb))
  }, [entities, frameWidth, frameHeight, box.w, box.h])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-zinc-950 [box-shadow:inset_0_0_80px_rgba(0,0,0,0.45)]"
    >
      <img
        key={src}
        src={src}
        alt={label}
        className="absolute inset-0 h-full w-full object-contain [image-rendering:auto]"
        onLoad={() => {
          setStreamOk(true)
          retryDelay.current = 2000
        }}
        onError={() => {
          setStreamOk(false)
          scheduleRetry()
        }}
      />

      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      <FishThumbnailStrip entities={entities} frameSeq={frameSeq} />

      {/* Camera label badge */}
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/75 px-2.5 py-1.5 shadow-lg backdrop-blur-md">
        <div className={`h-2 w-2 rounded-full shadow-[0_0_8px_currentColor] ${streamOk ? "bg-emerald-400 text-emerald-400" : "bg-zinc-600 text-zinc-600"}`} />
        <span className="text-[10px] font-medium tracking-wider text-zinc-200">{label}</span>
      </div>

      {nightMode && streamOk && (
        <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-950/60 px-2.5 py-1.5 backdrop-blur-md">
          <div className="h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
          <span className="text-[10px] font-medium tracking-wider text-indigo-200">Night</span>
        </div>
      )}

      {!streamOk && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/80">
          <div className="h-2 w-2 rounded-full bg-zinc-600" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Camera offline
          </span>
          <span className="text-[9px] font-mono text-zinc-600">{label}</span>
        </div>
      )}
    </div>
  )
}

export function LiveFeedCanvas() {
  const frameSeq        = useObservationStore((s) => s.frameSeq)
  const entities        = useObservationStore((s) => s.entities)
  const frameWidth      = useObservationStore((s) => s.frameWidth)
  const frameHeight     = useObservationStore((s) => s.frameHeight)
  const nightMode       = useObservationStore((s) => s.nightMode)
  const pipelineActive  = useObservationStore((s) => s.pipeline.camera_active)
  const cam2Active      = useObservationStore((s) => s.pipeline.cam2_active)
  const cam2Entities    = useObservationStore((s) => s.cam2Entities)
  const cam2FrameWidth  = useObservationStore((s) => s.cam2FrameWidth)
  const cam2FrameHeight = useObservationStore((s) => s.cam2FrameHeight)

  return (
    <div className="absolute inset-0 flex gap-px bg-zinc-800/80 p-px">
      {/* Cam 1 — annotated detection feed */}
      <CameraPane
        src={STREAM_URL}
        label="Cam 1"
        entities={entities}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        frameSeq={frameSeq}
        nightMode={nightMode}
        pipelineActive={pipelineActive}
      />

      {/* Cam 2 — only shown when backend confirms it's streaming */}
      {cam2Active && (
        <>
          <div className="w-px shrink-0 bg-zinc-700/80" />
          <CameraPane
            src={STREAM_URL_2}
            label="Cam 2"
            entities={cam2Entities}
            frameWidth={cam2FrameWidth}
            frameHeight={cam2FrameHeight}
            frameSeq={frameSeq}
            nightMode={nightMode}
            pipelineActive={cam2Active}
          />
        </>
      )}
    </div>
  )
}
