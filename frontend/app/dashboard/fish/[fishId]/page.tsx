"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  getFishSummary, getFishZoneHeatmap,
  getFishInteractionHistory, getFishConfidenceHistory,
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

export default function FishDrilldown() {
  const params  = useParams()
  const router  = useRouter()
  const fishId  = params.fishId as string
  const zones   = useTankStore((s) => s.zones)
  const entities = useObservationStore((s) => s.entities)

  const [tab,     setTab]     = useState<Tab>("heatmap")
  const [summary, setSummary] = useState<FishSummary | null>(null)
  const [heatmap, setHeatmap] = useState<Record<string, number>>({})
  const [events,  setEvents]  = useState<BehaviorEvent[]>([])
  const [history, setHistory] = useState<ConfidencePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [sum, hm, evts, hist] = await Promise.all([
          getFishSummary(fishId),
          getFishZoneHeatmap(fishId),
          getFishInteractionHistory(fishId),
          getFishConfidenceHistory(fishId),
        ])
        setSummary(sum)
        setHeatmap(hm.zone_time_fractions)
        setEvents(evts)
        setHistory(hist)
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

  // Check if currently tracked
  const liveEntity   = entities.find((e) => e.identity?.fish_id === fish.uuid)
  const isTracked    = !!liveEntity
  const liveConf     = liveEntity?.identity?.confidence ?? 0
  const speciesGuessConf = fish.species_guess_confidence ?? null

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-label text-muted-foreground hover:text-foreground block mb-4"
        >
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
            <span className="text-label text-muted-foreground border border-border rounded px-1.5 py-0.5" data-value>
              {fish.size_class}
            </span>
            {fish.estimated_length_cm && (
              <span className="text-label text-muted-foreground" data-value>
                {fish.estimated_length_cm}cm
              </span>
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
