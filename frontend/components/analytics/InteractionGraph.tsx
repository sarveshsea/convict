"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { listEvents } from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { TEMP_COLOR } from "@/lib/constants"
import type { BehaviorEvent, KnownFish } from "@/lib/api"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Node {
  id: string
  name: string
  species: string
  temperament: string
  x: number; y: number
  vx: number; vy: number
  radius: number
  eventCount: number
}

interface Edge {
  a: number; b: number   // node indices
  weight: number
  dominant: string       // event_type with highest count
  counts: Record<string, number>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const K_REPEL  = 6000
const K_SPRING = 0.04
const L_REST   = 130
const GRAVITY  = 0.015
const DAMPING  = 0.87
const BG       = "#09090f"

const EVENT_COLORS: Record<string, string> = {
  harassment:   "#f43f5e",
  chase:        "#fb7185",
  hiding:       "#fbbf24",
  missing_fish: "#f43f5e",
  lethargy:     "#fbbf24",
  schooling:    "#34d399",
  dispersion:   "#71717a",
}

const TEMP_NODE_COLOR: Record<string, string> = {
  aggressive:        "#f43f5e",
  "semi-aggressive": "#fbbf24",
  peaceful:          "#60a5fa",
}

// ── Force simulation ──────────────────────────────────────────────────────────

function simulate(nodes: Node[], edges: Edge[], cx: number, cy: number) {
  // Repulsion between every pair
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      const d2 = dx * dx + dy * dy + 1
      const d  = Math.sqrt(d2)
      const f  = K_REPEL / d2
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      nodes[i].vx -= fx; nodes[i].vy -= fy
      nodes[j].vx += fx; nodes[j].vy += fy
    }
  }

  // Spring attraction along edges
  for (const e of edges) {
    const a = nodes[e.a]; const b = nodes[e.b]
    const dx = b.x - a.x; const dy = b.y - a.y
    const d  = Math.sqrt(dx * dx + dy * dy) + 0.01
    const stretch = d - L_REST
    const f = K_SPRING * stretch
    const fx = (dx / d) * f; const fy = (dy / d) * f
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
  }

  // Center gravity + damping + integrate
  for (const n of nodes) {
    n.vx += (cx - n.x) * GRAVITY
    n.vy += (cy - n.y) * GRAVITY
    n.vx *= DAMPING; n.vy *= DAMPING
    n.x  += n.vx;   n.y  += n.vy
    // Keep within canvas
    n.x = Math.max(n.radius + 4, Math.min(cx * 2 - n.radius - 4, n.x))
    n.y = Math.max(n.radius + 4, Math.min(cy * 2 - n.radius - 4, n.y))
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function draw(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  edges: Edge[],
  W: number,
  H: number,
  hovered: number | null,
) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // Subtle grid
  ctx.strokeStyle = "rgba(63,63,70,0.18)"
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y < H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }

  if (nodes.length === 0) {
    ctx.fillStyle = "rgba(113,113,122,0.6)"
    ctx.font = "11px 'Fira Code', monospace"
    ctx.textAlign = "center"
    ctx.fillText("no fish registered yet", W / 2, H / 2)
    return
  }

  // Edges
  for (const e of edges) {
    const a = nodes[e.a]; const b = nodes[e.b]
    const color = EVENT_COLORS[e.dominant] ?? "#52525b"
    const alpha = 0.18 + Math.min(e.weight / 10, 0.6)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = color
    ctx.lineWidth   = 0.8 + Math.min(e.weight * 0.25, 3)
    ctx.globalAlpha = alpha
    if (hovered === e.a || hovered === e.b) {
      ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.globalAlpha = 0.85
    }
    ctx.stroke()
    ctx.restore()

    // Edge label (event count) at midpoint, only when hovered
    if ((hovered === e.a || hovered === e.b) && e.weight > 0) {
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2
      ctx.save()
      ctx.font = "9px 'Fira Code', monospace"
      ctx.textAlign = "center"
      ctx.fillStyle = color
      ctx.globalAlpha = 0.85
      ctx.fillText(`${e.weight}×`, mx, my - 4)
      ctx.restore()
    }
  }

  // Nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const isHovered = hovered === i
    const color = TEMP_NODE_COLOR[n.temperament] ?? "#60a5fa"

    ctx.save()
    // Glow
    ctx.shadowColor = color
    ctx.shadowBlur  = isHovered ? 20 : 10
    // Fill
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
    ctx.fillStyle   = color
    ctx.globalAlpha = isHovered ? 0.20 : 0.12
    ctx.fill()
    // Ring
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth   = isHovered ? 2.5 : 1.8
    ctx.globalAlpha = isHovered ? 1 : 0.75
    ctx.stroke()
    ctx.restore()

    // Name label
    ctx.save()
    ctx.font      = `${isHovered ? "bold " : ""}10px 'Fira Code', monospace`
    ctx.textAlign = "center"
    ctx.fillStyle = isHovered ? "#ffffff" : "rgba(228,228,231,0.85)"
    ctx.globalAlpha = 1
    ctx.fillText(n.name, n.x, n.y + n.radius + 14)
    if (n.eventCount > 0) {
      ctx.font      = "9px 'Fira Code', monospace"
      ctx.fillStyle = color
      ctx.globalAlpha = 0.65
      ctx.fillText(`${n.eventCount} ev`, n.x, n.y + n.radius + 25)
    }
    ctx.restore()
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function buildGraph(fish: KnownFish[], events: BehaviorEvent[], W: number, H: number) {
  const nodes: Node[] = fish.map((f, i) => {
    const angle = (i / Math.max(fish.length, 1)) * Math.PI * 2
    const r     = Math.min(W, H) * 0.28
    return {
      id:          f.uuid,
      name:        f.name,
      species:     f.species,
      temperament: f.temperament,
      x:  W / 2 + Math.cos(angle) * r,
      y:  H / 2 + Math.sin(angle) * r,
      vx: 0, vy: 0,
      radius:     10,
      eventCount: 0,
    }
  })

  const idxOf = (id: string) => nodes.findIndex((n) => n.id === id)

  const edgeMap = new Map<string, Edge>()
  for (const ev of events) {
    const involved = ev.involved_fish ?? []
    for (let p = 0; p < involved.length; p++) {
      for (let q = p + 1; q < involved.length; q++) {
        const ai = idxOf(involved[p].fish_id)
        const bi = idxOf(involved[q].fish_id)
        if (ai < 0 || bi < 0) continue
        const key = `${Math.min(ai, bi)}-${Math.max(ai, bi)}`
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { a: Math.min(ai, bi), b: Math.max(ai, bi), weight: 0, dominant: ev.event_type, counts: {} })
        }
        const edge = edgeMap.get(key)!
        edge.weight++
        edge.counts[ev.event_type] = (edge.counts[ev.event_type] ?? 0) + 1
        // Recalculate dominant
        edge.dominant = Object.entries(edge.counts).sort((a, b) => b[1] - a[1])[0][0]
      }
      // Track total events per fish
      const ni = idxOf(involved[p].fish_id)
      if (ni >= 0) nodes[ni].eventCount++
    }
  }

  // Scale node radius by event count (8–20px)
  const maxEvents = Math.max(...nodes.map((n) => n.eventCount), 1)
  for (const n of nodes) {
    n.radius = 8 + (n.eventCount / maxEvents) * 12
  }

  return { nodes, edges: Array.from(edgeMap.values()) }
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 bg-zinc-950/80 border border-border/40 rounded p-3">
      <p className="text-label text-muted-foreground mb-1">Node color = temperament</p>
      {[["aggressive", "#f43f5e"], ["semi-aggressive", "#fbbf24"], ["peaceful", "#60a5fa"]].map(([t, c]) => (
        <div key={t} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
          <span className="text-label" style={{ color: c }}>{t}</span>
        </div>
      ))}
      <p className="text-label text-muted-foreground mt-1.5">Edge color = event type</p>
      {[["harassment / chase", "#f43f5e"], ["hiding / lethargy", "#fbbf24"], ["schooling", "#34d399"]].map(([t, c]) => (
        <div key={t} className="flex items-center gap-2">
          <div className="w-6 h-px shrink-0" style={{ background: c }} />
          <span className="text-label" style={{ color: c }}>{t}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function InteractionGraph() {
  const fish          = useTankStore((s) => s.fish).filter((f) => f.is_active)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const nodesRef      = useRef<Node[]>([])
  const edgesRef      = useRef<Edge[]>([])
  const rafRef        = useRef<number>(0)
  const boxRef        = useRef({ w: 0, h: 0 })
  const hoveredRef    = useRef<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [eventCount, setEventCount] = useState(0)

  // Load events and build graph
  useEffect(() => {
    listEvents(200).then((events) => {
      setEventCount(events.length)
      const box = boxRef.current
      const { nodes, edges } = buildGraph(fish, events, box.w || 600, box.h || 400)
      nodesRef.current = nodes
      edgesRef.current = edges
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [fish.map((f) => f.uuid).join(",")])

  // Canvas sizing
  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const sync = () => {
      const cw  = container.clientWidth
      const ch  = container.clientHeight
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(cw * dpr)
      canvas.height = Math.round(ch * dpr)
      canvas.style.width  = `${cw}px`
      canvas.style.height = `${ch}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      boxRef.current = { w: cw, h: ch }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const loop = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const { w, h } = boxRef.current
      if (w < 1 || h < 1) { rafRef.current = requestAnimationFrame(loop); return }
      simulate(nodesRef.current, edgesRef.current, w / 2, h / 2)
      draw(ctx, nodesRef.current, edgesRef.current, w, h, hoveredRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect  = canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
    const nodes = nodesRef.current
    let hit: number | null = null
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - mx
      const dy = nodes[i].y - my
      if (Math.sqrt(dx * dx + dy * dy) <= nodes[i].radius + 8) { hit = i; break }
    }
    hoveredRef.current = hit
    setHovered(hit)
  }, [])

  const hoveredNode = hovered !== null ? nodesRef.current[hovered] : null

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseMove={onMouseMove}
        onMouseLeave={() => { hoveredRef.current = null; setHovered(null) }}
        style={{ cursor: hovered !== null ? "pointer" : "default" }}
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-caption text-muted-foreground">loading events…</span>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 right-4 bg-zinc-950/90 border border-border/50 rounded p-3 space-y-1 min-w-36 pointer-events-none">
          <p className="text-detail font-medium text-foreground">{hoveredNode.name}</p>
          <p className="text-caption text-muted-foreground italic">{hoveredNode.species.split(" ").slice(0, 2).join(" ")}</p>
          <p className="text-label text-muted-foreground mt-1">{hoveredNode.eventCount} events total</p>
          {/* Edges involving this node */}
          {edgesRef.current
            .filter((e) => e.a === hovered || e.b === hovered)
            .sort((a, b) => b.weight - a.weight)
            .map((e) => {
              const other = nodesRef.current[e.a === hovered ? e.b : e.a]
              return (
                <div key={`${e.a}-${e.b}`} className="flex items-center justify-between gap-3">
                  <span className="text-label text-muted-foreground">{other?.name}</span>
                  <span className="text-label font-mono" style={{ color: EVENT_COLORS[e.dominant] ?? "#71717a" }}>
                    {e.weight}× {e.dominant.replace("_", " ")}
                  </span>
                </div>
              )
            })}
        </div>
      )}

      {/* Stats badge */}
      <div className="absolute top-4 left-4 flex gap-2 flex-wrap">
        <div className="bg-zinc-950/80 border border-border/40 rounded px-2.5 py-1">
          <span className="text-label text-muted-foreground">{fish.length} fish</span>
        </div>
        <div className="bg-zinc-950/80 border border-border/40 rounded px-2.5 py-1">
          <span className="text-label text-muted-foreground">{edgesRef.current.length} relationships</span>
        </div>
        <div className="bg-zinc-950/80 border border-border/40 rounded px-2.5 py-1">
          <span className="text-label text-muted-foreground">{eventCount} events analysed</span>
        </div>
      </div>

      <Legend />
    </div>
  )
}
