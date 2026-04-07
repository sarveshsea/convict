"use client"
import { useState, useEffect } from "react"
import { getTank, createTank, updateTank } from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export function StepTank({ onNext }: { onNext: () => void }) {
  const { tank, setTank } = useTankStore()
  const [name, setName] = useState(tank?.name ?? "")
  const [gallons, setGallons] = useState(String(tank?.volume_gallons ?? ""))
  const [notes, setNotes] = useState(tank?.notes ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isUpdate = !!tank

  // Sync form if tank loads in from store after mount
  useEffect(() => {
    if (tank) {
      setName(tank.name)
      setGallons(String(tank.volume_gallons))
      setNotes(tank.notes ?? "")
    }
  }, [tank?.uuid])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const payload = { name, volume_gallons: parseInt(gallons), notes: notes || undefined }
      let result
      if (isUpdate) {
        result = await updateTank(payload)
      } else {
        try {
          result = await createTank(payload)
        } catch (err: any) {
          // Race: tank created between check and submit — fall back to PATCH
          if (err.status === 409) {
            result = await updateTank(payload)
          } else {
            throw err
          }
        }
      }
      setTank(result)
      onNext()
    } catch (err: any) {
      setError(err.message ?? "Failed to save tank")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-sm font-medium mb-0.5">
          {isUpdate ? "Tank Configuration" : "Tank Configuration"}
        </h2>
        <p className="text-[10px] text-muted-foreground">Define the physical environment.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tank-name" className="text-[9px] text-muted-foreground uppercase tracking-widest">
          Tank Name
        </Label>
        <Input id="tank-name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="South American Cichlid 60G" required
          className="bg-surface border-border text-xs h-8" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gallons" className="text-[9px] text-muted-foreground uppercase tracking-widest">
          Volume (gallons)
        </Label>
        <Input id="gallons" type="number" min={1} value={gallons}
          onChange={(e) => setGallons(e.target.value)} required
          className="bg-surface border-border text-xs h-8 w-28" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes" className="text-[9px] text-muted-foreground uppercase tracking-widest">
          Notes <span className="lowercase">(optional)</span>
        </Label>
        <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="South American biotope, heavily planted..."
          className="bg-surface border-border text-xs h-8" />
      </div>

      {error && <p className="text-[10px] text-destructive">{error}</p>}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading} className="text-[11px] h-7 px-3">
          {loading ? "saving…" : "continue →"}
        </Button>
      </div>
    </form>
  )
}
