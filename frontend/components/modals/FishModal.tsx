"use client"
import { useEffect } from "react"
import { X } from "lucide-react"
import { useUIStore } from "@/store/uiStore"
import { FishDrilldownPanel } from "@/components/drilldown/FishDrilldownPanel"

export function FishModal() {
  const { fishModalId, closeFishModal } = useUIStore()

  useEffect(() => {
    if (!fishModalId) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeFishModal() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [fishModalId, closeFishModal])

  if (!fishModalId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end pointer-events-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeFishModal}
      />

      {/* Panel — slides in from right */}
      <div className="relative z-10 w-full max-w-xl bg-background border-l border-border/60 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Panel header */}
        <div className="flex items-center justify-end px-4 py-2 border-b border-border/40 shrink-0">
          <button
            onClick={closeFishModal}
            className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 rounded"
          >
            <X size={14} />
          </button>
        </div>

        <FishDrilldownPanel fishId={fishModalId} />
      </div>
    </div>
  )
}
