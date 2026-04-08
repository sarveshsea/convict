"use client"
import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { ChevronLeft, ChevronRight, Users2, SlidersHorizontal, LayoutGrid, Activity, X, Plus, ChevronDown, Lock } from "lucide-react"
import { useTankStore } from "@/store/tankStore"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useAuthStore, useIsAuthed } from "@/store/authStore"
import { createFish, deleteFish, resolvePrediction } from "@/lib/api"
import { searchFish } from "@/lib/fishDatabase"
import type { KnownFish } from "@/lib/api"
import type { LiveEntity } from "@/store/observationStore"
import type { AnomalyItem, PredictionItem } from "@/store/predictionStore"
import { formatDistanceToNow } from "@/lib/timeUtils"

const TankConfigurator3D = dynamic(
  () => import("@/components/tank/TankConfigurator3D").then(m => m.TankConfigurator3D),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm font-mono text-zinc-600 uppercase tracking-widest">Loading 3D…</span>
    </div>
  )},
)

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type Tab = "roster" | "config" | "snapshots" | "intel"
const TABS: { key: Tab; Icon: typeof Users2; label: string }[] = [
  { key: "config",    Icon: SlidersHorizontal,  label: "Config"    },
  { key: "roster",    Icon: Users2,             label: "Roster"    },
  { key: "snapshots", Icon: LayoutGrid,          label: "Snapshots" },
  { key: "intel",     Icon: Activity,            label: "Intel"     },
]

const TEMP_COLOR: Record<string, string> = {
  aggressive:        "bg-rose-500",
  "semi-aggressive": "bg-amber-400",
  peaceful:          "bg-blue-400",
}

const PREDICTION_COLORS: Record<string, string> = {
  aggression_escalation: "text-rose-400 border-rose-400/30",
  isolation_trend:       "text-amber-400 border-amber-400/30",
  territory_shift:       "text-blue-400 border-blue-400/30",
  schooling_break:       "text-zinc-400 border-zinc-400/30",
  feeding_disruption:    "text-orange-400 border-orange-400/30",
}

const SEVERITY_COLORS: Record<string, string> = {
  high:   "text-rose-400 border-rose-400/30",
  medium: "text-amber-400 border-amber-400/30",
  low:    "text-zinc-500 border-zinc-700",
}

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

// ─── Fish Row ────────────────────────────────────────────────────────────────

function FishRow({ fish, entity }: { fish: KnownFish; entity: LiveEntity | undefined }) {
  const conf = entity?.identity?.confidence ?? 0
  const isTracked = !!entity
  const { removeFish } = useTankStore()
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const sp = speciesLabel(fish.species)
  const confColor = conf >= 0.7 ? "bg-emerald-400" : conf >= 0.4 ? "bg-amber-400" : "bg-rose-500"
  const dotColor  = isTracked ? confColor : "bg-zinc-700"

  return (
    <div className={`relative group border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors ${isTracked ? "" : "opacity-55"}`}>
      <Link href={`/dashboard/fish/${fish.uuid}`} className="flex items-center gap-2.5 px-3 py-2.5 pr-8">
        <div className="w-10 h-10 rounded shrink-0 bg-zinc-900 border border-zinc-800/60 overflow-hidden relative flex items-center justify-center">
          {!imgFailed ? (
            <img src={`${API}/api/v1/tank/fish/${fish.uuid}/snapshot`} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
          ) : (
            <span className="text-sm font-mono text-zinc-600 select-none">{fish.name.slice(0, 2).toUpperCase()}</span>
          )}
          <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${TEMP_COLOR[fish.temperament] ?? "bg-zinc-700"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
            <span className="text-base font-medium truncate text-foreground leading-none">{fish.name}</span>
            {fish.auto_detected && (
              <span className="text-sm font-mono text-zinc-600 border border-zinc-700/50 rounded px-0.5 shrink-0">a</span>
            )}
          </div>
          <span className={`text-sm font-mono truncate block leading-none ${sp.muted ? "text-zinc-600 italic" : sp.possible ? "text-amber-400/70" : "text-zinc-500"}`}>
            {sp.possible && <span className="text-zinc-600">~&thinsp;</span>}{sp.text}
          </span>
          {isTracked && conf > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="flex-1 h-px bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${confColor} transition-all duration-300`} style={{ width: `${conf * 100}%` }} />
              </div>
              <span className="text-sm font-mono text-zinc-600 tabular-nums shrink-0">{(conf * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      </Link>
      {confirmDelete ? (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={async (e) => {
              e.preventDefault()
              setDeleting(true)
              try { await deleteFish(fish.uuid); removeFish(fish.uuid) }
              catch { setDeleting(false); setConfirmDelete(false) }
            }}
            disabled={deleting}
            className="text-[10px] font-mono text-rose-400 border border-rose-400/30 rounded px-1.5 py-0.5 hover:bg-rose-400/10 transition-colors disabled:opacity-40"
          >
            {deleting ? "…" : "delete"}
          </button>
          <button
            onClick={(e) => { e.preventDefault(); setConfirmDelete(false) }}
            className="text-[10px] font-mono text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 hover:text-zinc-400 transition-colors"
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.preventDefault(); setConfirmDelete(true) }}
          className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-rose-400 transition-all p-0.5"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ─── Add Fish Inline ──────────────────────────────────────────────────────────

function AddFishInline() {
  const { addFish } = useTankStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [species, setSpecies] = useState("")
  const [results, setResults] = useState<ReturnType<typeof searchFish>>([])
  const [showDrop, setShowDrop] = useState(false)
  const [size, setSize] = useState<"small" | "medium" | "large">("medium")
  const [temp, setTemp] = useState<"peaceful" | "semi-aggressive" | "aggressive">("peaceful")
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
    // Use selected species from dropdown, or fall back to whatever was typed
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
    <div className="border-t border-zinc-800/60">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-base font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <Plus size={12} />
        add fish
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <form onSubmit={submit} className="px-3 pb-3 space-y-2">
          {/* Species search */}
          <div ref={dropRef} className="relative">
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => query.length >= 2 && setShowDrop(results.length > 0)}
              placeholder="search species…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
            />
            {showDrop && (
              <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                {results.map((r, i) => (
                  <button key={i} type="button"
                    onClick={() => { setQuery(r.common_name); setSpecies(r.species); setSize(r.size_class); setTemp(r.temperament); setShowDrop(false) }}
                    className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-zinc-800 text-left border-b border-zinc-800/50 last:border-0">
                    <span className="text-sm text-foreground">{r.common_name}</span>
                    <span className="text-sm text-zinc-500 italic ml-2 truncate">{r.species}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Size */}
          <div className="flex gap-1">
            {(["small", "medium", "large"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)}
                className={`flex-1 text-sm py-1.5 rounded border transition-colors
                  ${size === s ? "border-zinc-500 text-foreground bg-zinc-800" : "border-zinc-800 text-zinc-600 hover:border-zinc-700"}`}>
                {s}
              </button>
            ))}
          </div>

          {/* Temperament */}
          <div className="flex gap-1">
            {(["peaceful", "semi-aggressive", "aggressive"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTemp(t)}
                className={`flex-1 text-sm py-1.5 rounded border transition-colors
                  ${temp === t
                    ? t === "aggressive" ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                      : t === "semi-aggressive" ? "border-amber-400/40 text-amber-400 bg-amber-400/10"
                      : "border-blue-400/40 text-blue-400 bg-blue-400/10"
                    : "border-zinc-800 text-zinc-600 hover:border-zinc-700"}`}>
                {t === "semi-aggressive" ? "semi" : t}
              </button>
            ))}
          </div>

          <button type="submit" disabled={(!species && !query) || loading}
            className="w-full text-base font-mono py-2 rounded border border-zinc-700 text-zinc-400 hover:text-foreground hover:border-zinc-600 transition-colors disabled:opacity-30">
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
  const activeFish = fish.filter((f) => f.is_active)
  const unresolved = entities.filter((e) => !e.identity?.fish_id)

  function entityForFish(f: KnownFish): LiveEntity | undefined {
    return entities.find((e) => e.identity?.fish_id === f.uuid)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {activeFish.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-base font-mono text-zinc-700">watching…</div>
        ) : (
          activeFish.map((f) => <FishRow key={f.uuid} fish={f} entity={entityForFish(f)} />)
        )}

        {unresolved.length > 0 && (
          <div className="border-t border-zinc-800/60">
            <div className="px-3 py-2">
              <span className="text-sm font-mono text-zinc-700 uppercase tracking-widest">Unresolved</span>
            </div>
            {unresolved.map((e) => (
              <div key={e.track_id} className="px-3 py-1.5 border-t border-zinc-800/30 opacity-40">
                <span className="text-sm font-mono text-zinc-600">T{e.track_id}</span>
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

  function markFailed(uuid: string) {
    setFailed((prev) => new Set([...prev, uuid]))
  }

  return (
    <div className="p-3">
      {fish.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-base font-mono text-zinc-700">no fish yet</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {fish.map((f) => (
            <Link key={f.uuid} href={`/dashboard/fish/${f.uuid}`} className="group flex flex-col gap-1">
              <div className="aspect-square rounded bg-zinc-900 border border-zinc-800/60 overflow-hidden relative flex items-center justify-center">
                {!failed.has(f.uuid) ? (
                  <img
                    src={`${API}/api/v1/tank/fish/${f.uuid}/snapshot`}
                    alt=""
                    className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                    onError={() => markFailed(f.uuid)}
                  />
                ) : (
                  <span className="text-base font-mono text-zinc-600">{f.name.slice(0, 2).toUpperCase()}</span>
                )}
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${TEMP_COLOR[f.temperament] ?? "bg-zinc-700"}`} />
              </div>
              <span className="text-sm font-mono text-zinc-400 truncate leading-none">{f.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Intel Tab ────────────────────────────────────────────────────────────────

function IntelTab() {
  const anomalies   = usePredictionStore((s) => s.anomalies)
  const predictions = usePredictionStore((s) => s.predictions).filter((p) => p.status === "active")
  const upsertPrediction = usePredictionStore((s) => s.upsertPrediction)
  const [resolving, setResolving] = useState<string | null>(null)

  async function resolve(p: PredictionItem, outcome: "resolved_correct" | "resolved_incorrect") {
    setResolving(p.uuid)
    try { await resolvePrediction(p.uuid, outcome); upsertPrediction({ ...p, status: outcome }) }
    catch {}
    finally { setResolving(null) }
  }

  return (
    <div className="flex flex-col divide-y divide-zinc-800/60">

      {/* Predictions */}
      <div>
        <div className="px-3 py-2.5 flex items-center justify-between">
          <span className="text-sm font-mono text-zinc-500 uppercase tracking-widest">Predictions</span>
          {predictions.length > 0 && <span className="text-sm font-mono text-zinc-600">{predictions.length}</span>}
        </div>
        {predictions.length === 0 ? (
          <div className="px-3 pb-3 text-base font-mono text-zinc-700">none active</div>
        ) : predictions.map((p) => (
          <div key={p.uuid} className="px-3 py-2.5 border-t border-zinc-800/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-mono uppercase px-1.5 py-0.5 rounded border ${PREDICTION_COLORS[p.prediction_type] ?? "text-zinc-400 border-zinc-700"}`}>
                {p.prediction_type.replace(/_/g, " ")}
              </span>
              <span className="text-sm font-mono text-zinc-500 tabular-nums">{(p.confidence * 100).toFixed(0)}%</span>
            </div>
            <p className="text-base text-zinc-400 leading-relaxed">{p.narrative}</p>
            {p.involved_fish.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.involved_fish.map((f) => (
                  <span key={f.fish_id} className="text-sm font-mono text-zinc-500 border border-zinc-800 rounded px-1 py-0.5">{f.fish_name}</span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <button disabled={resolving === p.uuid} onClick={() => resolve(p, "resolved_correct")}
                className="text-sm font-mono px-2 py-0.5 rounded border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40">
                correct
              </button>
              <button disabled={resolving === p.uuid} onClick={() => resolve(p, "resolved_incorrect")}
                className="text-sm font-mono px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-rose-400/30 hover:text-rose-400 transition-colors disabled:opacity-40">
                incorrect
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Anomalies */}
      <div>
        <div className="px-3 py-2.5 flex items-center justify-between">
          <span className="text-sm font-mono text-zinc-500 uppercase tracking-widest">Anomalies</span>
          {anomalies.length > 0 && <span className="text-sm font-mono text-zinc-600">{anomalies.length}</span>}
        </div>
        {anomalies.length === 0 ? (
          <div className="px-3 pb-3 text-base font-mono text-zinc-700">none flagged</div>
        ) : anomalies.slice(0, 15).map((a) => (
          <div key={a.uuid} className="px-3 py-2.5 border-t border-zinc-800/40">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-sm font-mono uppercase px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[a.severity] ?? "text-zinc-400 border-zinc-700"}`}>
                {a.event_type.replace(/_/g, " ")}
              </span>
              <span className="text-sm font-mono text-zinc-600">{formatDistanceToNow(a.started_at)} ago</span>
            </div>
            {a.involved_fish.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {a.involved_fish.map((f) => (
                  <span key={f.fish_id} className="text-sm font-mono text-zinc-500">{f.fish_name}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}

// ─── Auth Gate ────────────────────────────────────────────────────────────────

function AuthGate({ onUnlock }: { onUnlock: () => void }) {
  const { login, passwordRequired } = useAuthStore()
  const [pw, setPw]       = useState("")
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(false)
    const ok = await login(pw)
    setLoading(false)
    if (ok) onUnlock()
    else { setError(true); setPw("") }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
      <Lock size={20} className="text-zinc-600" />
      <p className="text-xs font-mono text-zinc-500 text-center">Config is password protected</p>
      <form onSubmit={submit} className="w-full space-y-2">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="password"
          autoFocus
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-foreground placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        {error && <p className="text-xs text-rose-400 font-mono">wrong password</p>}
        <button type="submit" disabled={!pw || loading}
          className="w-full py-2 rounded border border-zinc-700 text-xs font-mono text-zinc-400 hover:text-foreground hover:border-zinc-500 transition-colors disabled:opacity-30">
          {loading ? "checking…" : "unlock"}
        </button>
      </form>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function LeftPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab]             = useState<Tab>("config")
  const isAuthed = useIsAuthed()
  const { checkStatus } = useAuthStore()

  useEffect(() => { checkStatus() }, [])

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 flex flex-col items-center border-r border-zinc-800/60 bg-zinc-950 pointer-events-auto py-2 gap-1">
        <button onClick={() => setCollapsed(false)} className="p-2 text-zinc-600 hover:text-foreground transition-colors">
          <ChevronRight size={15} />
        </button>
        <div className="w-px h-3 bg-zinc-800 rounded-full mx-auto" />
        {TABS.map(({ key, Icon }) => (
          <button key={key} title={key}
            onClick={() => { setTab(key); setCollapsed(false) }}
            className={`p-2 transition-colors rounded ${tab === key ? "text-primary" : "text-zinc-600 hover:text-zinc-400"}`}>
            <Icon size={15} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <aside className="w-[664px] shrink-0 flex flex-col border-r border-zinc-800/60 bg-zinc-950 overflow-hidden pointer-events-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/60 shrink-0 flex items-center justify-between">
        <div>
          <span className="text-sm font-mono text-zinc-600 tracking-widest uppercase block">Convict</span>
          <span className="text-lg font-medium tracking-tight leading-tight">Tank Intelligence</span>
        </div>
        <button onClick={() => setCollapsed(true)} className="text-zinc-600 hover:text-foreground transition-colors p-1 rounded">
          <ChevronLeft size={15} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-zinc-800/60 shrink-0 px-1 pt-1">
        {TABS.map(({ key, Icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-mono border-b-2 -mb-px transition-colors
              ${tab === key ? "border-primary text-foreground" : "border-transparent text-zinc-600 hover:text-zinc-400"}`}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === "intel" && <IntelTab />}
        {tab !== "intel" && !isAuthed && <AuthGate onUnlock={() => {}} />}
        {tab === "roster"    && isAuthed && <RosterTab />}
        {tab === "config"    && isAuthed && <ConfigTab />}
        {tab === "snapshots" && isAuthed && <SnapshotsTab />}
      </div>
    </aside>
  )
}
