"use client"
import { useState, useRef, useEffect, useMemo } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { ChevronLeft, ChevronRight, Users2, SlidersHorizontal, LayoutGrid, Activity, X, Plus, ChevronDown } from "lucide-react"
import { useTankStore } from "@/store/tankStore"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { createFish, deleteFish, resolvePrediction } from "@/lib/api"
import { searchFish } from "@/lib/fishDatabase"
import { fishSnapshotUrl, TEMP_COLOR, PREDICTION_COLORS, SEVERITY_COLORS } from "@/lib/constants"
import { ConfidenceBar } from "@/components/ui/confidence-bar"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionHeader } from "@/components/ui/section-header"
import type { KnownFish } from "@/lib/api"
import type { LiveEntity } from "@/store/observationStore"
import type { PredictionItem } from "@/store/predictionStore"
import { formatDistanceToNow } from "@/lib/timeUtils"

const TankConfigurator3D = dynamic(
  () => import("@/components/tank/TankConfigurator3D").then(m => m.TankConfigurator3D),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Loading 3D…</span>
    </div>
  )},
)

type Tab = "roster" | "config" | "snapshots" | "intel"
type SortKey = "name" | "confidence" | "species"

const TABS: { key: Tab; Icon: typeof Users2; label: string }[] = [
  { key: "config",    Icon: SlidersHorizontal, label: "Config"    },
  { key: "roster",    Icon: Users2,            label: "Roster"    },
  { key: "snapshots", Icon: LayoutGrid,         label: "Snapshots" },
  { key: "intel",     Icon: Activity,           label: "Intel"     },
]

function extractCommon(species: string): string {
  const m = species.match(/\(([^)]+)\)/)
  if (m) return m[1]
  return species.split(" ").slice(0, 2).join(" ")
}

function speciesLabel(species: string) {
  if (!species || species === "Unknown" || species === "")
    return { text: "identifying…", muted: true, possible: false }
  if (species.startsWith("Possible: "))
    return { text: extractCommon(species.slice("Possible: ".length)), muted: false, possible: true }
  return { text: extractCommon(species), muted: false, possible: false }
}

// ─── Fish Row ─────────────────────────────────────────────────────────────────

function FishRow({ fish, entity }: { fish: KnownFish; entity: LiveEntity | undefined }) {
  const conf      = entity?.identity?.confidence ?? 0
  const isTracked = !!entity
  const { removeFish } = useTankStore()
  const [deleting, setDeleting]   = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const sp = speciesLabel(fish.species)

  if (deleting) {
    return <div className="h-14 mx-3 my-1.5 rounded animate-pulse bg-muted/40" />
  }

  return (
    <div className={`relative group border-b border-border/40 hover:bg-muted/40 transition-colors ${isTracked ? "" : "opacity-55"}`}>
      <Link href={`/dashboard/fish/${fish.uuid}`} className="flex items-center gap-3 px-3 py-2.5 pr-8">
        <div className={`w-10 h-10 rounded shrink-0 bg-muted border border-border/60 overflow-hidden relative flex items-center justify-center ${isTracked ? "ring-1 ring-primary/40" : ""}`}>
          {!imgFailed ? (
            <img src={fishSnapshotUrl(fish.uuid)} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
          ) : (
            <span className="text-sm font-mono text-muted-foreground select-none">{fish.name.slice(0, 2).toUpperCase()}</span>
          )}
          <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${TEMP_COLOR[fish.temperament] ?? "bg-border"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-medium truncate text-foreground leading-none">{fish.name}</span>
            {fish.auto_detected && (
              <span className="text-label text-muted-foreground border border-border/50 rounded px-0.5 shrink-0 normal-case" title="auto-detected fish">
                auto
              </span>
            )}
          </div>
          <span className={`text-caption truncate block leading-none ${sp.muted ? "text-muted-foreground italic" : sp.possible ? "text-amber-400/70" : "text-muted-foreground"}`}>
            {sp.possible && <span className="text-muted-foreground">~&thinsp;</span>}{sp.text}
          </span>
          {isTracked && conf > 0 && (
            <ConfidenceBar value={conf} className="mt-1" />
          )}
        </div>
      </Link>
      <button
        onClick={async (e) => {
          e.preventDefault()
          setDeleting(true)
          try { await deleteFish(fish.uuid); removeFish(fish.uuid) }
          catch { setDeleting(false) }
        }}
        disabled={deleting}
        className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400 transition-all p-0.5 disabled:opacity-30"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Add Fish Inline ──────────────────────────────────────────────────────────

function AddFishInline() {
  const { addFish } = useTankStore()
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState("")
  const [species, setSpecies] = useState("")
  const [results, setResults] = useState<ReturnType<typeof searchFish>>([])
  const [showDrop, setShowDrop] = useState(false)
  const [size, setSize]   = useState<"small" | "medium" | "large">("medium")
  const [temp, setTemp]   = useState<"peaceful" | "semi-aggressive" | "aggressive">("peaceful")
  const [loading, setLoading] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function onQuery(q: string) {
    setQuery(q)
    const hits = searchFish(q)
    setResults(hits)
    setShowDrop(hits.length > 0)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const finalSpecies = species.trim() || query.trim()
    if (!finalSpecies) return
    const commonMatch = finalSpecies.match(/\(([^)]+)\)/)
    const name = commonMatch ? commonMatch[1] : finalSpecies.split(" ").slice(0, 2).join(" ")
    setLoading(true)
    try {
      const f = await createFish({ name, species: finalSpecies, size_class: size, temperament: temp })
      addFish(f)
      setQuery(""); setSpecies(""); setOpen(false)
    } catch {}
    finally { setLoading(false) }
  }

  return (
    <div className="border-t border-border/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-caption text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={12} />
        add fish
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <form onSubmit={submit} className="px-3 pb-3 space-y-2">
          <div ref={dropRef} className="relative">
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => query.length >= 2 && setShowDrop(results.length > 0)}
              placeholder="search species…"
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border/80"
            />
            {showDrop && (
              <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-card border border-border rounded shadow-xl overflow-hidden max-h-48 overflow-y-auto scrollbar-thin">
                {results.map((r, i) => (
                  <button key={i} type="button"
                    onClick={() => { setQuery(r.common_name); setSpecies(r.species); setSize(r.size_class); setTemp(r.temperament); setShowDrop(false) }}
                    className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-muted text-left border-b border-border/40 last:border-0">
                    <span className="text-sm text-foreground">{r.common_name}</span>
                    <span className="text-caption text-muted-foreground italic ml-2 truncate">{r.species}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1">
            {(["small", "medium", "large"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)}
                className={`flex-1 text-caption py-1.5 rounded border transition-colors
                  ${size === s ? "border-border/80 text-foreground bg-muted" : "border-border/40 text-muted-foreground hover:border-border/60"}`}>
                {s}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {(["peaceful", "semi-aggressive", "aggressive"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTemp(t)}
                className={`flex-1 text-caption py-1.5 rounded border transition-colors
                  ${temp === t
                    ? t === "aggressive" ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                      : t === "semi-aggressive" ? "border-amber-400/40 text-amber-400 bg-amber-400/10"
                      : "border-blue-400/40 text-blue-400 bg-blue-400/10"
                    : "border-border/40 text-muted-foreground hover:border-border/60"}`}>
                {t === "semi-aggressive" ? "semi" : t}
              </button>
            ))}
          </div>

          <button type="submit" disabled={(!species && !query) || loading}
            className="w-full text-caption py-2 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-30">
            {loading ? "adding…" : "+ add"}
          </button>
        </form>
      )}
    </div>
  )
}

// ─── Roster Tab ───────────────────────────────────────────────────────────────

function RosterTab() {
  const fish     = useTankStore((s) => s.fish)
  const entities = useObservationStore((s) => s.entities)
  const [sort, setSort] = useState<SortKey>("name")

  const activeFish = useMemo(() => {
    const list = fish.filter((f) => f.is_active)
    if (sort === "confidence") {
      return [...list].sort((a, b) => {
        const ca = entities.find((e) => e.identity?.fish_id === a.uuid)?.identity?.confidence ?? 0
        const cb = entities.find((e) => e.identity?.fish_id === b.uuid)?.identity?.confidence ?? 0
        return cb - ca
      })
    }
    if (sort === "species") return [...list].sort((a, b) => a.species.localeCompare(b.species))
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [fish, entities, sort])

  const unresolved = entities.filter((e) => !e.identity?.fish_id)

  function entityForFish(f: KnownFish): LiveEntity | undefined {
    return entities.find((e) => e.identity?.fish_id === f.uuid)
  }

  return (
    <div className="flex flex-col h-full">
      {activeFish.length > 1 && (
        <div className="px-3 py-1.5 border-b border-border/40 flex items-center gap-1 shrink-0">
          <span className="text-label text-muted-foreground mr-1">sort</span>
          {(["name", "confidence", "species"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-label px-1.5 py-0.5 rounded transition-colors ${
                sort === s ? "text-primary border border-primary/30 bg-primary/5" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "confidence" ? "↑conf" : s}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {activeFish.length === 0
          ? <EmptyState message="watching…" />
          : activeFish.map((f) => <FishRow key={f.uuid} fish={f} entity={entityForFish(f)} />)
        }

        {unresolved.length > 0 && (
          <div className="border-t border-border/40">
            <SectionHeader label="Unresolved" count={unresolved.length} />
            {unresolved.map((e) => (
              <div key={e.track_id} className="px-3 py-1.5 border-t border-border/30 opacity-40">
                <span className="text-caption text-muted-foreground">T{e.track_id}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <AddFishInline />
    </div>
  )
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TankConfigurator3D />
    </div>
  )
}

// ─── Snapshots Tab ────────────────────────────────────────────────────────────

function SnapshotsTab() {
  const fish = useTankStore((s) => s.fish).filter((f) => f.is_active)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [cols, setCols]     = useState<2 | 3>(() => {
    if (typeof window !== "undefined") {
      return (parseInt(localStorage.getItem("snapshot_cols") ?? "2") as 2 | 3)
    }
    return 2
  })

  function toggleCols() {
    const next = cols === 2 ? 3 : 2
    setCols(next)
    localStorage.setItem("snapshot_cols", String(next))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b border-border/40 flex items-center justify-between shrink-0">
        <span className="text-label text-muted-foreground">Snapshots</span>
        <button
          onClick={toggleCols}
          className="text-label text-muted-foreground hover:text-foreground transition-colors border border-border/40 rounded px-1.5 py-0.5"
        >
          {cols}×col
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {fish.length === 0
          ? <EmptyState message="no fish yet" />
          : (
            <div className={`grid gap-2 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {fish.map((f) => (
                <Link key={f.uuid} href={`/dashboard/fish/${f.uuid}`} className="group flex flex-col gap-1">
                  <div className="aspect-square rounded bg-muted border border-border/60 overflow-hidden relative flex items-center justify-center">
                    {!failed.has(f.uuid) ? (
                      <img
                        src={fishSnapshotUrl(f.uuid)}
                        alt=""
                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                        onError={() => failed.has(f.uuid) || setFailed((p) => new Set([...p, f.uuid]))}
                      />
                    ) : (
                      <span className="text-sm font-mono text-muted-foreground">{f.name.slice(0, 2).toUpperCase()}</span>
                    )}
                    <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${TEMP_COLOR[f.temperament] ?? "bg-border"}`} />
                  </div>
                  <span className="text-caption text-muted-foreground truncate leading-none">{f.name}</span>
                </Link>
              ))}
            </div>
          )
        }
      </div>
    </div>
  )
}

// ─── Intel Tab ────────────────────────────────────────────────────────────────

function IntelTab() {
  const anomalies   = usePredictionStore((s) => s.anomalies)
  const predictions = usePredictionStore((s) => s.predictions).filter((p) => p.status === "active")
  const upsertPrediction = usePredictionStore((s) => s.upsertPrediction)
  const [resolving, setResolving] = useState<string | null>(null)
  const allClear = predictions.length === 0 && anomalies.length === 0

  async function resolve(p: PredictionItem, outcome: "resolved_correct" | "resolved_incorrect") {
    setResolving(p.uuid)
    try { await resolvePrediction(p.uuid, outcome); upsertPrediction({ ...p, status: outcome }) }
    catch {}
    finally { setResolving(null) }
  }

  return (
    <div className="flex flex-col divide-y divide-border/40 overflow-y-auto scrollbar-thin">
      <div>
        <SectionHeader label="Predictions" count={predictions.length} countColor="text-muted-foreground" />
        {predictions.length === 0 ? (
          <EmptyState message="none active" height="sm" />
        ) : predictions.map((p) => (
          <div key={p.uuid} className="px-3 py-2.5 border-t border-border/40 space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <span className={`text-label px-1.5 py-0.5 rounded border ${PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-border"}`}>
                {p.prediction_type.replace(/_/g, " ")}
              </span>
              <span className="text-caption text-muted-foreground tabular-nums" data-value>{(p.confidence * 100).toFixed(0)}%</span>
            </div>
            <p className="text-detail text-muted-foreground leading-relaxed">{p.narrative}</p>
            {p.involved_fish.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.involved_fish.map((f) => (
                  <span key={f.fish_id} className="text-caption text-muted-foreground border border-border rounded px-1 py-0.5">{f.fish_name}</span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <button disabled={resolving === p.uuid} onClick={() => resolve(p, "resolved_correct")}
                className="text-label px-2 py-0.5 rounded border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40">
                correct
              </button>
              <button disabled={resolving === p.uuid} onClick={() => resolve(p, "resolved_incorrect")}
                className="text-label px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-rose-400/30 hover:text-rose-400 transition-colors disabled:opacity-40">
                incorrect
              </button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <SectionHeader label="Anomalies" count={anomalies.length} countColor="text-muted-foreground" />
        {anomalies.length === 0 ? (
          allClear ? (
            <div className="flex flex-col items-center justify-center h-20 gap-1 text-muted-foreground">
              <span className="text-xs">✓</span>
              <span className="text-label">all clear</span>
            </div>
          ) : <EmptyState message="none flagged" height="sm" />
        ) : anomalies.slice(0, 15).map((a) => (
          <div key={a.uuid} className="px-3 py-2.5 border-t border-border/40">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-label px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[a.severity] ?? "text-zinc-400 border-border"}`}>
                {a.event_type.replace(/_/g, " ")}
              </span>
              <span className="text-caption text-muted-foreground">{formatDistanceToNow(a.started_at)} ago</span>
            </div>
            {a.involved_fish.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {a.involved_fish.map((f) => (
                  <span key={f.fish_id} className="text-caption text-muted-foreground">{f.fish_name}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function LeftPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("left_panel_tab") as Tab) ?? "config"
    }
    return "config"
  })

  function switchTab(t: Tab) {
    setTab(t)
    if (typeof window !== "undefined") localStorage.setItem("left_panel_tab", t)
  }

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 flex flex-col items-center border-r border-border/40 bg-background pointer-events-auto py-2 gap-1">
        <button onClick={() => setCollapsed(false)} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight size={15} />
        </button>
        <div className="w-px h-3 bg-border rounded-full mx-auto" />
        {TABS.map(({ key, Icon }) => (
          <button key={key} title={key}
            onClick={() => { switchTab(key); setCollapsed(false) }}
            className={`p-2 transition-colors rounded ${tab === key ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon size={15} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <aside className="w-[520px] shrink-0 flex flex-col border-r border-border/40 bg-background overflow-hidden pointer-events-auto">
      <div className="px-4 py-3 border-b border-border/40 shrink-0 flex items-center justify-between">
        <div>
          <span className="text-label text-muted-foreground block">Convict</span>
          <span className="text-lg font-medium tracking-tight leading-tight">Tank Intelligence</span>
        </div>
        <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="flex items-center border-b border-border/40 shrink-0 px-1 pt-1">
        {TABS.map(({ key, Icon, label }) => (
          <button key={key} onClick={() => switchTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-caption border-b-2 -mb-px transition-colors
              ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === "roster"    && <RosterTab />}
        {tab === "config"    && <ConfigTab />}
        {tab === "snapshots" && <SnapshotsTab />}
        {tab === "intel"     && <IntelTab />}
      </div>
    </aside>
  )
}
