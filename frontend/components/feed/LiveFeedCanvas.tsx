"use client"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { STREAM_URL, STREAM_URL_2, HLS_URL, HLS_URL_2, fishSnapshotUrl } from "@/lib/constants"
import { useObservationStore } from "@/store/observationStore"
import { useTankStore } from "@/store/tankStore"
import type { LiveEntity } from "@/store/observationStore"

// ─── Halftone canvas ──────────────────────────────────────────────────────────

function HalftoneCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext("2d")!
    const dpr = window.devicePixelRatio || 1
    let W = 0, H = 0, raf = 0, t = 0, scanY = 0
    const GAP = 11

    const resize = () => {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      if (w < 1 || h < 1) return
      W = w; H = h
      canvas.width  = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // ── Value noise (no sine waves, no periodic pattern) ──────────────────
    const fract  = (x: number) => x - Math.floor(x)
    const smooth = (x: number) => x * x * (3 - 2 * x)
    const mix    = (a: number, b: number, t: number) => a + (b - a) * t

    function hash(x: number, y: number): number {
      const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
      return fract(Math.abs(v))
    }
    function noise(x: number, y: number): number {
      const ix = Math.floor(x), iy = Math.floor(y)
      const fx = x - ix,        fy = y - iy
      const ux = smooth(fx),    uy = smooth(fy)
      return mix(
        mix(hash(ix, iy),   hash(ix+1, iy),   ux),
        mix(hash(ix, iy+1), hash(ix+1, iy+1), ux),
        uy,
      )
    }
    // FBM — 3 octaves of value noise
    function fbm(x: number, y: number): number {
      return noise(x, y) * 0.57
           + noise(x * 2.07, y * 2.07) * 0.28
           + noise(x * 4.17, y * 4.17) * 0.15
    }

    const draw = () => {
      if (W < 1) { resize(); raf = requestAnimationFrame(draw); return }
      ctx.fillStyle = "#09090f"
      ctx.fillRect(0, 0, W, H)
      t += 0.014

      const cols  = Math.ceil(W / GAP) + 1
      const rows  = Math.ceil(H / GAP) + 1
      const MAX_R = (GAP / 2) * 0.78
      const SC    = 0.042   // grid → noise coordinate scale

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = c * GAP
          const y = r * GAP
          // Domain warp — reduced amplitude avoids extreme clustering
          const wx = fbm(c * SC + t * 0.21,       r * SC + t * 0.13      ) * 1.5
          const wy = fbm(c * SC - t * 0.17 + 5.3, r * SC + t * 0.09 + 1.9) * 1.5
          const n  = fbm(c * SC + wx + t * 0.08,  r * SC + wy - t * 0.06 )
          // Quadratic + floor: uniform field of small dots, larger in bright areas
          const k  = n * n * 0.82 + 0.08
          ctx.beginPath()
          ctx.arc(x, y, k * MAX_R, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(160,185,255,${(k * 0.55).toFixed(2)})`
          ctx.fill()
        }
      }

      // Scan line — slow horizontal sweep (18s period)
      scanY = (scanY + 1.8) % H
      const sy = Math.floor(scanY)
      const grad = ctx.createLinearGradient(0, 0, W, 0)
      grad.addColorStop(0,   "rgba(100,150,255,0)")
      grad.addColorStop(0.3, "rgba(100,150,255,0.18)")
      grad.addColorStop(0.7, "rgba(100,150,255,0.18)")
      grad.addColorStop(1,   "rgba(100,150,255,0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, sy, W, 1)
      // Soft glow 2px above/below
      ctx.fillStyle = "rgba(100,150,255,0.06)"
      ctx.fillRect(0, sy - 1, W, 1)
      ctx.fillRect(0, sy + 1, W, 1)
      raf = requestAnimationFrame(draw)
    }

    resize()
    raf = requestAnimationFrame(draw)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" />
}

// ─── Offline status card ──────────────────────────────────────────────────────

function OfflineCard() {
  const tank = useTankStore((s) => s.tank)
  const rows = [
    { label: "STATUS", value: "OFFLINE" },
    { label: "TANK",   value: tank?.name?.toUpperCase() ?? "—" },
    { label: "CAMERA", value: "NOT ACTIVE" },
    { label: "MODE",   value: "STANDBY" },
  ]
  return (
    <div className="absolute right-12 bottom-12 w-56 bg-black/70 border border-white/10 backdrop-blur-md p-5 space-y-3">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-label text-white/35 w-14 shrink-0">{label}</span>
          <span className="text-label text-white/25">›</span>
          <span className="text-label text-white font-medium tracking-widest truncate">{value}</span>
        </div>
      ))}
      <div className="flex gap-[2px] pt-1">
        {Array.from({ length: 48 }).map((_, i) => (
          <div key={i} className="h-px bg-white/15 flex-1" />
        ))}
      </div>
      <div className="flex justify-between items-center">
        <span className="text-label text-white/25 tracking-widest">CONVICT</span>
        <span className="text-label text-white/25">WAITING</span>
      </div>
    </div>
  )
}

// ─── Connecting indicator ─────────────────────────────────────────────────────

function ConnectingBar() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 48), 80)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex flex-col items-center gap-4 pointer-events-none">
      <div className="flex items-center gap-4">
        <span className="text-label text-white/40 w-16 shrink-0">STATUS</span>
        <span className="text-label text-white/25">›</span>
        <span className="text-label text-white tracking-widest">CONNECTING</span>
      </div>
      <div className="flex gap-[3px]">
        {Array.from({ length: 48 }).map((_, i) => (
          <div
            key={i}
            className="w-px transition-none"
            style={{
              height: 14,
              background: i <= tick
                ? `rgba(255,255,255,${0.15 + (i / 48) * 0.7})`
                : "rgba(255,255,255,0.08)",
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-label text-white/40 w-16 shrink-0">CAMERA</span>
        <span className="text-label text-white/25">›</span>
        <span className="text-label text-white/70 tracking-widest">INITIALIZING</span>
      </div>
    </div>
  )
}

function confidenceColor(c: number): string {
  if (c >= 0.7) return "#34d399"
  if (c >= 0.4) return "#fbbf24"
  return "#f43f5e"
}

/** Derive a stable, visually-distinct hue from a fish UUID. */
function fishHue(fishId: string): number {
  let h = 0
  for (let i = 0; i < fishId.length; i++) {
    h = fishId.charCodeAt(i) + ((h << 5) - h)
  }
  // Avoid the red-ish band (330-30°) which clashes with error states
  const raw = Math.abs(h) % 300
  return raw < 30 ? raw + 30 : raw
}

/** Per-fish identity color (stable hue) or confidence fallback when unidentified. */
function entityColor(e: LiveEntity): string {
  if (e.identity?.fish_id) {
    const hue = fishHue(e.identity.fish_id)
    const conf = e.identity.confidence
    const l = conf >= 0.7 ? 68 : conf >= 0.4 ? 62 : 56
    return `hsl(${hue}, 80%, ${l}%)`
  }
  return confidenceColor(0)  // blue-grey for unidentified
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

  const color    = entityColor(e)
  const chipMeta = getChipState(e.identity)
  const bw = rx2 - rx1
  const bh = ry2 - ry1
  const clen = Math.max(8, Math.min(bw * 0.2, bh * 0.2, 20))

  // ── Corner brackets ────────────────────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth   = 2
  ctx.globalAlpha = 0.92
  ctx.lineCap     = "square"
  ctx.shadowColor = color
  ctx.shadowBlur  = 6
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
  ctx.restore()

  // ── Trail — tapering width + opacity gradient, glow at head ────────────────
  if (e.trail.length > 1) {
    const n = e.trail.length
    ctx.save()
    ctx.lineCap    = "round"
    ctx.lineJoin   = "round"
    ctx.strokeStyle = color
    for (let j = 1; j < n; j++) {
      const t    = j / n                         // 0 = oldest, 1 = newest
      const px0  = e.trail[j - 1][0] * scaleX + offX
      const py0  = e.trail[j - 1][1] * scaleY + offY
      const px1  = e.trail[j][0] * scaleX + offX
      const py1  = e.trail[j][1] * scaleY + offY
      ctx.beginPath()
      ctx.lineWidth    = 0.5 + t * 2.5           // thin at tail, thick at head
      ctx.globalAlpha  = t * 0.70
      if (j === n - 1) { ctx.shadowColor = color; ctx.shadowBlur = 8 }
      else              { ctx.shadowBlur = 0 }
      ctx.moveTo(px0, py0)
      ctx.lineTo(px1, py1)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Head dot + confidence ring ──────────────────────────────────────────────
  const hx = (rx1 + rx2) / 2
  const hy = (ry1 + ry2) / 2

  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur  = 10
  ctx.beginPath()
  ctx.arc(hx, hy, 4, 0, Math.PI * 2)
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.92
  ctx.fill()
  ctx.restore()

  if (e.identity?.fish_id) {
    const conf = e.identity.confidence
    ctx.save()
    ctx.beginPath()
    ctx.arc(hx, hy, 9, -Math.PI / 2, -Math.PI / 2 + conf * Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth   = 1.5
    ctx.globalAlpha = 0.55
    ctx.stroke()
    ctx.restore()
  }

  // ── Label chip ─────────────────────────────────────────────────────────────
  ctx.globalAlpha = 1
  const conf    = e.identity?.confidence ?? 0
  const confStr = e.identity?.fish_id ? ` ${(conf * 100).toFixed(0)}%` : ""

  if (chipMeta.scanning) {
    const phase    = Math.floor(Date.now() / 350) % 3
    const dotLabel = "identifying" + ".".repeat(phase + 1)
    ctx.font = "10px 'Geist Mono', monospace"
    const tw    = ctx.measureText(dotLabel).width
    const chipX = rx1
    const chipY = Math.max(0, ry1 - 18)
    ctx.fillStyle   = "rgba(9,9,11,0.70)"
    ctx.fillRect(chipX, chipY, tw + 10, 16)
    ctx.fillStyle   = chipMeta.color
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 600))
    ctx.fillText(dotLabel, chipX + 5, chipY + 11)
    ctx.globalAlpha = 1
  } else {
    const label = `${chipMeta.text}${confStr}`
    ctx.font = "bold 11px 'Geist Mono', monospace"
    const tw    = ctx.measureText(label).width
    const chipX = rx1
    const chipY = Math.max(0, ry1 - 18)
    ctx.fillStyle = "rgba(9,9,11,0.82)"
    ctx.fillRect(chipX, chipY, tw + 10, 16)
    ctx.fillStyle = color
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
      .sort((a, b) => b.conf - a.conf)
      .slice(0, 4)   // max 4 thumbnails — keeps strip compact
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
    <Link href={`/dashboard/fish/${fishId}`}
      className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/12 bg-zinc-950/85 py-1.5 pl-1.5 pr-2.5 shadow-xl shadow-black/50 ring-1 ring-white/8 backdrop-blur-md hover:bg-zinc-900/90 transition-colors">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-white/10">
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
    </Link>
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60">
          <div className="h-2 w-2 rounded-full bg-status-unknown" />
          <span className="text-label text-muted-foreground">Camera offline</span>
          <span className="text-label text-muted-foreground/40">{label}</span>
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
  const pipelineRunning = useObservationStore((s) => s.pipeline.running)
  const cam2Entities    = useObservationStore((s) => s.cam2Entities)
  const cam2FrameWidth  = useObservationStore((s) => s.cam2FrameWidth)
  const cam2FrameHeight = useObservationStore((s) => s.cam2FrameHeight)

  return (
    <div className="absolute inset-0 flex gap-px bg-border/20 p-px">
      {/* Offline: halftone canvas + status card */}
      {!pipelineRunning && (
        <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
          <HalftoneCanvas />
          <OfflineCard />
        </div>
      )}

      {/* Connecting: pipeline started but camera not yet active */}
      {pipelineRunning && !pipelineActive && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-background/80">
          <ConnectingBar />
        </div>
      )}
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
          <div className="w-px shrink-0 bg-border/60" />
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
