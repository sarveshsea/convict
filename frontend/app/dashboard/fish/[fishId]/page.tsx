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
import { ZoneHeatmap } from "@/components/drilldown/ZoneHeatmap"
import { InteractionHistory } from "@/components/drilldown/InteractionHistory"
import { BehaviorBaseline } from "@/components/drilldown/BehaviorBaseline"
import { IdentityConfidenceChart } from "@/components/drilldown/IdentityConfidenceChart"
import { EvidenceChain } from "@/components/drilldown/EvidenceChain"

type Tab = "heatmap" | "interactions" | "baseline" | "confidence" | "evidence"

const TABS: { id: Tab; label: string }[] = [
  { id: "heatmap",      label: "Zone Heatmap" },
  { id: "baseline",     label: "Baseline" },
  { id: "interactions", label: "Interactions" },
  { id: "confidence",   label: "Activity" },
  { id: "evidence",     label: "Evidence Chain" },
]

const TEMP_STYLE: Record<string, string> = {
  aggressive:       "text-rose-400 border-rose-400/30 bg-rose-400/5",
  "semi-aggressive":"text-amber-400 border-amber-400/30 bg-amber-400/5",
  peaceful:         "text-blue-400 border-blue-400/30 bg-blue-400/5",
}

export default function FishDrilldown() {
  const params  = useParams()
  const router  = useRouter()
  const fishId  = params.fishId as string
  const zones   = useTankStore((s) => s.zones)

  const [tab,      setTab]      = useState<Tab>("heatmap")
  const [summary,  setSummary]  = useState<FishSummary | null>(null)
  const [heatmap,  setHeatmap]  = useState<Record<string, number>>({})
  const [events,   setEvents]   = useState<BehaviorEvent[]>([])
  const [history,  setHistory]  = useState<ConfidencePoint[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

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
      <div className="flex items-center justify-center h-screen text-[10px] font-mono text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-2" />
        loading…
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="text-[11px] font-mono text-destructive">{error ?? "Fish not found"}</p>
        <Link href="/dashboard" className="text-[10px] font-mono text-muted-foreground hover:text-foreground">
          ← back to dashboard
        </Link>
      </div>
    )
  }

  const { fish, baseline } = summary

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-[9px] font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest block mb-4"
        >
          ← dashboard
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium tracking-tight">{fish.name}</h1>
            <p className="text-[11px] text-muted-foreground italic mt-0.5">{fish.species}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${TEMP_STYLE[fish.temperament]}`}>
              {fish.temperament}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
              {fish.size_class}
            </span>
            {fish.estimated_length_cm && (
              <span className="text-[9px] font-mono text-muted-foreground">
                {fish.estimated_length_cm}cm
              </span>
            )}
          </div>
        </div>

        {fish.appearance_notes && (
          <p className="text-[10px] text-muted-foreground mt-1">{fish.appearance_notes}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[10px] font-mono whitespace-nowrap border-b-2 transition-colors -mb-px
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
        {tab === "interactions" && <InteractionHistory events={events} />}
        {tab === "confidence"   && <IdentityConfidenceChart history={history} />}
        {tab === "evidence"     && <EvidenceChain fishUuid={fish.uuid} fishName={fish.name} />}
      </div>
    </div>
  )
}
