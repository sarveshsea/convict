"use client"
import { useEffect } from "react"
import { X } from "lucide-react"
import { useUIStore } from "@/store/uiStore"
import { InteractionGraph } from "@/components/analytics/InteractionGraph"

export function GraphModal() {
  const { graphOpen, closeGraph } = useUIStore()

  useEffect(() => {
    if (!graphOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeGraph() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [graphOpen, closeGraph])

  if (!graphOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col pointer-events-auto animate-in fade-in duration-150">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeGraph} />

      {/* Panel */}
      <div className="relative z-10 m-6 flex-1 min-h-0 bg-background border border-border/60 rounded-lg flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 shrink-0">
          <span className="text-caption text-foreground">Interaction Graph</span>
          <div className="flex items-center gap-3">
            <p className="text-label text-muted-foreground">force-directed · last 200 events · hover to inspect</p>
            <button onClick={closeGraph} className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 rounded">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 relative min-h-0">
          <InteractionGraph />
        </div>
      </div>
    </div>
  )
}
