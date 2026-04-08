"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  getFishSummary, getFishZoneHeatmap,
  getFishInteractionHistory, getFishConfidenceHistory,
  getRelationships,
  type FishSummary, type BehaviorEvent, type ConfidencePoint,
} from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { useObservationStore } from "@/store/observationStore"
import { TEMP_TEXT_COLOR } from "@/lib/constants"
import { ConfidenceBar } from "@/components/ui/confidence-bar"
import { ZoneHeatmap } from "@/components/drilldown/ZoneHeatmap"
import { InteractionHistory } from "@/components/drilldown/InteractionHistory"
import { BehaviorBaseline } from "@/components/drilldown/BehaviorBaseline"
import { IdentityConfidenceChart } from "@/components/drilldown/IdentityConfidenceChart"
import { EvidenceChain } from "@/components/drilldown/EvidenceChain"

type Tab = "heatmap" | "interactions" | "baseline" | "speed" | "evidence"

const TABS: { id: Tab; label: string }[] = [
  { id: "heatmap",      label: "Zone Heatmap" },
  { id: "baseline",     label: "Baseline" },
  { id: "interactions", label: "Interactions" },
  { id: "speed",        label: "Speed History" },
  { id: "evidence",     label: "Evidence Chain" },
]

// ── Behavioral fingerprint derived from baseline + interaction data ──────────

interface Fingerprint {
  peakHour: number | null          // hour of day with most activity
  topPartner: string | null        // name of most-interacted fish
  topPartnerType: string | null    // dominant interaction type with top partner
  role: "aggressor" | "passive" | "social" | "loner" | null
  dominantZoneId: string | null    // zone uuid with highest fraction
}

function deriveFingerprint(
  baseline: FishSummary["baseline"],
  edges: { fish_a_id: string; fish_b_id: string; weight: number; dominant_type: string; harassment_count: number }[],
  fishUuid: string,
  zones: { uuid: string; name: string }[],
): Fingerprint {
  // Peak hour
  const byHour = baseline?.activity_by_hour ?? {}
  const hourEntries = Object.entries(byHour).map(([h, c]) => [parseInt(h), c as number] as const)
  const peakHour = hourEntries.length > 0
    ? hourEntries.reduce((a, b) => b[1] > a[1] ? b : a)[0]
    : null

  // Top partner from edges
  const mine = edges.filter((e) => e.fish_a_id === fishUuid || e.fish_b_id === fishUuid)
  const top  = mine.sort((a, b) => b.weight - a.weight)[0]
  const topPartner     = top ? null : null   // resolved below in component with nodeNames
  const topPartnerType = top?.dominant_type ?? null

  // Role: aggressor if harassment edges are mostly initiated by this fish
  //       social if schooling edges exist
  //       loner if no edges at all
  //       passive otherwise
  const harassmentEdges = mine.filter((e) => e.dominant_type === "harassment")
  const schoolingEdges  = mine.filter((e) => e.dominant_type === "schooling")
  let role: Fingerprint["role"] = null
  if (mine.length === 0) {
    role = "loner"
  } else if (schoolingEdges.length >= harassmentEdges.length && schoolingEdges.length > 0) {
    role = "social"
  } else if (harassmentEdges.length > 0) {
    role = "aggressor"
  } else {
    role = "passive"
  }

  // Dominant zone
  const zoneFracs = baseline?.zone_time_fractions ?? {}
  const topZone = Object.entries(zoneFracs).sort((a, b) => (b[1] as number) - (a[1] as number))[0]
  const dominantZoneId = topZone ? topZone[0] : null

  return { peakHour, topPartner, topPartnerType, role, dominantZoneId }
}

const ROLE_STYLE: Record<string, string> = {
  aggressor: "text-rose-400 border-rose-400/30 bg-rose-500/10",
  passive:   "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
  social:    "text-emerald-400 border-emerald-400/30 bg-emerald-500/10",
  loner:     "text-amber-400 border-amber-400/30 bg-amber-400/10",
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FishDrilldown() {
  const params   = useParams()
  const fishId   = params.fishId as string
  const zones    = useTankStore((s) => s.zones)
  const entities = useObservationStore((s) => s.entities)

  const [tab,     setTab]     = useState<Tab>("heatmap")
  const [summary, setSummary] = useState<FishSummary | null>(null)
  const [heatmap, setHeatmap] = useState<Record<string, number>>({})
  const [events,  setEvents]  = useState<BehaviorEvent[]>([])
  const [history, setHistory] = useState<ConfidencePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Relationship data for fingerprint
  const [relEdges,     setRelEdges]     = useState<any[]>([])
  const [relNodeNames, setRelNodeNames] = useState<Record<string, string>>({})

  useEffect(() => {
    async function load() {
      try {
        const [sum, hm, evts, hist, rel] = await Promise.all([
          getFishSummary(fishId),
          getFishZoneHeatmap(fishId),
          getFishInteractionHistory(fishId),
          getFishConfidenceHistory(fishId),
          getRelationships(168).catch(() => ({ nodes: [], edges: [] })),
        ])
        setSummary(sum)
        setHeatmap(hm.zone_time_fractions)
        setEvents(evts)
        setHistory(hist)

        const nameMap: Record<string, string> = {}
        rel.nodes.forEach((n: { id: string; name: string }) => { nameMap[n.id] = n.name })
        setRelNodeNames(nameMap)
        setRelEdges(rel.edges.filter((e: any) => e.fish_a_id === fishId || e.fish_b_id === fishId))
      } catch (e: any) {
        setError(e.message ?? "Failed to load fish")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fishId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-caption text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-2" />
        loading…
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="text-detail font-mono text-destructive">{error ?? "Fish not found"}</p>
        <Link href="/dashboard" className="text-caption text-muted-foreground hover:text-foreground">
          ← back to dashboard
        </Link>
      </div>
    )
  }

  const { fish, baseline } = summary

  // Live tracking state
  const liveEntity        = entities.find((e) => e.identity?.fish_id === fish.uuid)
  const isTracked         = !!liveEntity
  const liveConf          = liveEntity?.identity?.confidence ?? 0
  const speciesGuessConf  = fish.species_guess_confidence ?? null

  // Behavioral fingerprint
  const fp = deriveFingerprint(baseline, relEdges, fish.uuid, zones)

  // Top partner name (needs nodeNames)
  const topEdge        = relEdges.sort((a, b) => b.weight - a.weight)[0]
  const topPartnerId   = topEdge ? (topEdge.fish_a_id === fish.uuid ? topEdge.fish_b_id : topEdge.fish_a_id) : null
  const topPartnerName = topPartnerId ? (relNodeNames[topPartnerId] ?? null) : null
  const dominantZone   = fp.dominantZoneId ? zones.find((z) => z.uuid === fp.dominantZoneId) : null

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard" className="text-label text-muted-foreground hover:text-foreground block mb-4">
          ← dashboard
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-xl font-medium tracking-tight">{fish.name}</h1>
              {isTracked && (
                <span className="text-label text-emerald-400 border border-emerald-400/30 bg-emerald-400/10 rounded px-1.5 py-0.5">
                  tracking
                </span>
              )}
            </div>
            <p className="text-caption text-muted-foreground italic">{fish.species}</p>
            {speciesGuessConf !== null && (
              <ConfidenceBar value={speciesGuessConf} className="mt-1 max-w-48" />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1 flex-wrap justify-end">
            <span className={`text-label px-1.5 py-0.5 rounded border ${TEMP_TEXT_COLOR[fish.temperament] ?? "text-muted-foreground border-border"}`}>
              {fish.temperament}
            </span>
            <span className="text-label text-muted-foreground border border-border rounded px-1.5 py-0.5">
              {fish.size_class}
            </span>
            {fish.estimated_length_cm && (
              <span className="text-label text-muted-foreground">{fish.estimated_length_cm}cm</span>
            )}
          </div>
        </div>

        {isTracked && liveConf > 0 && (
          <div className="mt-2">
            <p className="text-label text-muted-foreground mb-1">Live Confidence</p>
            <ConfidenceBar value={liveConf} className="max-w-48" />
          </div>
        )}

        {fish.appearance_notes && (
          <p className="text-caption text-muted-foreground mt-2">{fish.appearance_notes}</p>
        )}

        {/* ── Behavioral Fingerprint ──────────────────────────────────── */}
        {(fp.role || fp.peakHour !== null || dominantZone || topPartnerName) && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {fp.role && (
              <div className={`rounded border px-2.5 py-2 ${ROLE_STYLE[fp.role]}`}>
                <p className="text-label text-muted-foreground">Role</p>
                <p className="text-caption font-medium mt-0.5 capitalize">{fp.role}</p>
              </div>
            )}
            {fp.peakHour !== null && (
              <div className="rounded border border-border/40 bg-card px-2.5 py-2">
                <p className="text-label text-muted-foreground">Peak Hour</p>
                <p className="text-caption font-mono font-medium mt-0.5">
                  {String(fp.peakHour).padStart(2, "0")}:00
                </p>
              </div>
            )}
            {dominantZone && (
              <div className="rounded border border-border/40 bg-card px-2.5 py-2">
                <p className="text-label text-muted-foreground">Home Zone</p>
                <p className="text-caption font-medium mt-0.5 truncate">{dominantZone.name}</p>
              </div>
            )}
            {topPartnerName && (
              <div className="rounded border border-border/40 bg-card px-2.5 py-2">
                <p className="text-label text-muted-foreground">Most With</p>
                <p className="text-caption font-medium mt-0.5 truncate">{topPartnerName}</p>
                {topEdge?.dominant_type && (
                  <p className="text-label text-muted-foreground capitalize">{topEdge.dominant_type}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-caption whitespace-nowrap border-b-2 transition-colors -mb-px
              ${tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-card border border-border rounded p-4">
        {tab === "heatmap"      && <ZoneHeatmap zoneTimeFractions={heatmap} zones={zones} />}
        {tab === "baseline"     && <BehaviorBaseline baseline={baseline} />}
        {tab === "interactions" && <InteractionHistory events={events} fishUuid={fish.uuid} fishName={fish.name} />}
        {tab === "speed"        && <IdentityConfidenceChart history={history} />}
        {tab === "evidence"     && <EvidenceChain fishUuid={fish.uuid} fishName={fish.name} />}
      </div>
    </div>
  )
}
