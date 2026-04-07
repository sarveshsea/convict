"use client"
import { useState } from "react"
import { createSchedule, deleteSchedule, type ScheduleCreate } from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X } from "lucide-react"

const EVENT_ICONS: Record<string, string> = {
  feeding: "○", lights_on: "◑", lights_off: "●", water_change: "◇",
}
const EVENT_COLORS: Record<string, string> = {
  feeding: "text-emerald-400", lights_on: "text-amber-400",
  lights_off: "text-zinc-500", water_change: "text-blue-400",
}

export function StepSchedules({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const { schedules, addSchedule, removeSchedule } = useTankStore()
  const [form, setForm] = useState<ScheduleCreate>({
    event_type: "feeding", time_of_day: "08:00", days_of_week: undefined, notes: "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const s = await createSchedule({ ...form, notes: form.notes || undefined })
      addSchedule(s)
      setForm({ event_type: "feeding", time_of_day: "08:00", days_of_week: undefined, notes: "" })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(uuid: string) {
    try {
      await deleteSchedule(uuid)
      removeSchedule(uuid)
    } catch {}
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5">Schedules</h2>
        <p className="text-xs text-muted-foreground">
          Tank events provide temporal context for behavioral analysis.
          Feeding events especially unlock post-feeding pattern detection.
        </p>
      </div>

      {schedules.length > 0 && (
        <div className="space-y-1">
          {schedules.map((s) => (
            <div key={s.uuid} className="flex items-center justify-between px-3 py-1.5 rounded bg-surface border border-border/50">
              <div className="flex items-center gap-2">
                <span className={`text-base ${EVENT_COLORS[s.event_type]}`}>{EVENT_ICONS[s.event_type]}</span>
                <span className={`text-xs font-mono ${EVENT_COLORS[s.event_type]}`}>{s.event_type.replace("_", " ")}</span>
                <span className="text-xs font-mono text-muted-foreground">@ {s.time_of_day}</span>
                {s.notes && <span className="text-xs text-muted-foreground">— {s.notes}</span>}
              </div>
              <button onClick={() => handleDelete(s.uuid)} className="text-muted-foreground hover:text-destructive transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {schedules.length === 0 && (
        <div className="flex items-center justify-center h-12 rounded border border-dashed border-border text-xs text-muted-foreground font-mono">
          No schedules yet — optional but recommended
        </div>
      )}

      <form onSubmit={submit} className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <p className="col-span-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Add Schedule</p>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Event Type</Label>
          <Select value={form.event_type} onValueChange={(v) => setForm((f) => ({ ...f, event_type: v as any }))}>
            <SelectTrigger className="bg-surface border-border font-mono text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              {["feeding", "lights_on", "lights_off", "water_change"].map((t) => (
                <SelectItem key={t} value={t} className="font-mono text-xs">{t.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Time (24h)</Label>
          <Input type="time" value={form.time_of_day}
            onChange={(e) => setForm((f) => ({ ...f, time_of_day: e.target.value }))}
            required className="bg-surface border-border font-mono text-sm h-8" />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Notes (optional)</Label>
          <Input value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="2× daily, after lights on..." className="bg-surface border-border text-sm h-8" />
        </div>
        {error && <p className="col-span-2 text-xs text-destructive font-mono">{error}</p>}
        <div className="col-span-2">
          <Button type="submit" variant="outline" size="sm" disabled={loading} className="font-mono text-xs border-border">
            {loading ? "Adding…" : "+ Add Schedule"}
          </Button>
        </div>
      </form>

      <div className="flex justify-between pt-2 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="font-mono text-xs text-muted-foreground">← Back</Button>
        <Button onClick={onFinish} className="font-mono text-xs">
          Launch Convict →
        </Button>
      </div>
    </div>
  )
}
