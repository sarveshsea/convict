"use client"
import { useEffect } from "react"
import { X } from "lucide-react"
import { useUIStore } from "@/store/uiStore"
import { EventTimeline } from "@/components/analytics/EventTimeline"

export function TimelineModal() {
  const { timelineOpen, closeTimeline } = useUIStore()

  useEffect(() => {
    if (!timelineOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeTimeline() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [timelineOpen, closeTimeline])

  if (!timelineOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col pointer-events-auto animate-in fade-in duration-150">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeTimeline} />

      {/* Panel */}
      <div className="relative z-10 m-6 flex-1 min-h-0 bg-background border border-border/60 rounded-lg flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 shrink-0">
          <span className="text-caption text-foreground">Event Timeline</span>
          <div className="flex items-center gap-3">
            <p className="text-label text-muted-foreground">swim lanes per fish · hover events · zoom 1h – 7d</p>
            <button onClick={closeTimeline} className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 rounded">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <EventTimeline />
        </div>
      </div>
    </div>
  )
}
