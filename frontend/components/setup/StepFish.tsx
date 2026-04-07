"use client"
import { useState, useRef, useEffect } from "react"
import { createFish, deleteFish } from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { searchFish, type FishEntry } from "@/lib/fishDatabase"
import { X } from "lucide-react"

const TEMP_STYLE: Record<string, string> = {
  aggressive:       "text-rose-400 border-rose-400/30 bg-rose-400/8",
  "semi-aggressive":"text-amber-400 border-amber-400/30 bg-amber-400/8",
  peaceful:         "text-blue-400 border-blue-400/30 bg-blue-400/8",
}
const TEMP_SHORT: Record<string, string> = {
  aggressive: "aggro", "semi-aggressive": "semi", peaceful: "peaceful",
}

const REGION_LABEL: Record<string, string> = {
  south_american: "South American",
  central_american: "Central American",
  african: "African",
  asian: "Asian",
}

interface FishForm {
  name: string
  species: string
  common_name: string
  size_class: "small" | "medium" | "large"
  temperament: "aggressive" | "semi-aggressive" | "peaceful"
  estimated_length_cm: string
  appearance_notes: string
}

const BLANK: FishForm = {
  name: "", species: "", common_name: "",
  size_class: "medium", temperament: "peaceful",
  estimated_length_cm: "", appearance_notes: "",
}

export function StepFish({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { fish, addFish, removeFish } = useTankStore()
  const [form, setForm] = useState<FishForm>(BLANK)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<FishEntry[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function onQueryChange(q: string) {
    setQuery(q)
    const hits = searchFish(q)
    setResults(hits)
    setShowDropdown(hits.length > 0)
    // If query matches exactly a common name, don't auto-fill yet
    setForm((f) => ({ ...f, common_name: q }))
  }

  function selectSuggestion(entry: FishEntry) {
    setQuery(entry.common_name)
    setShowDropdown(false)
    setForm((f) => ({
      ...f,
      species: entry.species,
      common_name: entry.common_name,
      size_class: entry.size_class,
      temperament: entry.temperament,
      estimated_length_cm: String(entry.estimated_length_cm),
      appearance_notes: f.appearance_notes, // keep any notes user typed
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.species.trim()) { setError("Species is required"); return }
    // Auto-generate a name from the species common name or species string
    const commonMatch = form.species.match(/\(([^)]+)\)/)
    const autoName = commonMatch
      ? commonMatch[1]
      : form.species.split(" ").slice(0, 2).join(" ")
    setLoading(true); setError(null)
    try {
      const f = await createFish({
        name: autoName,
        species: form.species.trim(),
        common_name: form.common_name || undefined,
        size_class: form.size_class,
        temperament: form.temperament,
        estimated_length_cm: form.estimated_length_cm ? parseFloat(form.estimated_length_cm) : undefined,
        appearance_notes: form.appearance_notes || undefined,
      })
      addFish(f)
      setForm(BLANK); setQuery("")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-medium mb-0.5">Fish Discovery</h2>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Fish are detected and registered automatically as they become stable in frame. Species are
          inferred from color and size over time. Add known fish below to give the identity engine a
          stronger prior — or skip this step entirely.
        </p>
      </div>

      {/* Discovery info banner */}
      <div className="flex items-start gap-2 p-3 rounded border border-primary/20 bg-primary/5">
        <span className="text-[10px] font-mono text-primary/70 leading-relaxed">
          After ~30s of observation, each stable fish will appear in the roster automatically with an
          "auto" badge. The system will attempt to identify the species within 5 minutes.
        </span>
      </div>

      {/* Existing fish */}
      {fish.length > 0 && (
        <div className="space-y-1">
          {fish.filter((f) => f.is_active).map((f) => (
            <div key={f.uuid}
              className="flex items-center justify-between px-3 py-2 rounded bg-surface border border-border/40 group">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{f.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TEMP_STYLE[f.temperament]}`}>
                      {TEMP_SHORT[f.temperament]}
                    </span>
                    {f.auto_detected && (
                      <span className="text-[8px] font-mono px-1 py-0.5 rounded border border-zinc-600/40 text-zinc-500">
                        auto
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] italic ${
                    f.species.startsWith("Possible:") ? "text-amber-400/70" : "text-muted-foreground"
                  }`}>{f.species}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                <span>{f.size_class}</span>
                {f.estimated_length_cm && <span>{f.estimated_length_cm}cm</span>}
                <button onClick={async () => { await deleteFish(f.uuid); removeFish(f.uuid) }}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all ml-1">
                  <X size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {fish.length === 0 && (
        <div className="flex items-center justify-center h-12 rounded border border-dashed border-border text-[10px] text-muted-foreground">
          no fish yet
        </div>
      )}

      {/* Add form */}
      <form onSubmit={submit} className="space-y-3 pt-3 border-t border-border">
        {/* Species search */}
        <div ref={searchRef} className="relative">
          <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">
            Species Search
          </label>
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => query.length >= 2 && setShowDropdown(results.length > 0)}
            placeholder="search cichlids… e.g. oscar, frontosa, ram"
            className="bg-surface border-border text-xs h-8"
          />
          {showDropdown && (
            <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-card border border-border rounded shadow-xl overflow-hidden">
              {results.map((r, i) => (
                <button key={i} type="button" onClick={() => selectSuggestion(r)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface text-left transition-colors border-b border-border/30 last:border-0">
                  <div>
                    <span className="text-xs text-foreground">{r.common_name}</span>
                    <span className="text-[10px] text-muted-foreground italic ml-2">{r.species}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] text-muted-foreground">{REGION_LABEL[r.region]}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TEMP_STYLE[r.temperament]}`}>
                      {TEMP_SHORT[r.temperament]}
                    </span>
                    <span className="text-[9px] text-muted-foreground">{r.size_class}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Species (auto-filled or manual) */}
          <div className="col-span-2">
            <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">
              Species *
            </label>
            <Input value={form.species} onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))}
              placeholder="auto-filled from search above" className="bg-surface border-border text-xs h-8 italic" />
          </div>

          {/* Size class */}
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">Size</label>
            <div className="flex gap-1">
              {(["small", "medium", "large"] as const).map((s) => (
                <button key={s} type="button"
                  onClick={() => setForm((f) => ({ ...f, size_class: s }))}
                  className={`flex-1 text-[9px] py-1.5 rounded border transition-colors
                    ${form.size_class === s
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-border/80"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Temperament */}
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">Temperament</label>
            <div className="flex gap-1">
              {(["peaceful", "semi-aggressive", "aggressive"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => setForm((f) => ({ ...f, temperament: t }))}
                  className={`flex-1 text-[9px] py-1.5 rounded border transition-colors
                    ${form.temperament === t
                      ? `${TEMP_STYLE[t]}`
                      : "border-border text-muted-foreground hover:border-border/80"}`}>
                  {TEMP_SHORT[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Length */}
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">
              Est. Length (cm)
            </label>
            <Input type="number" step="0.5" min={1}
              value={form.estimated_length_cm}
              onChange={(e) => setForm((f) => ({ ...f, estimated_length_cm: e.target.value }))}
              placeholder="auto-filled" className="bg-surface border-border text-xs h-8" />
          </div>

          {/* Appearance notes */}
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-widest block mb-1">
              Appearance Notes
            </label>
            <Input value={form.appearance_notes}
              onChange={(e) => setForm((f) => ({ ...f, appearance_notes: e.target.value }))}
              placeholder="gold morph, torn fin, large…"
              className="bg-surface border-border text-xs h-8" />
          </div>
        </div>

        {error && <p className="text-[10px] text-destructive">{error}</p>}

        <Button type="submit" variant="outline" size="sm" disabled={loading}
          className="text-[11px] h-7 border-border">
          {loading ? "adding…" : "+ add fish"}
        </Button>
      </form>

      <div className="flex justify-between pt-2 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="text-[11px] h-7 px-2 text-muted-foreground">
          ← back
        </Button>
        <Button onClick={onNext} className="text-[11px] h-7 px-3">
          continue →
        </Button>
      </div>
    </div>
  )
}
