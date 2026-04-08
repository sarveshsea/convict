"use client"
import Link from "next/link"
import { WSProvider } from "@/components/WSProvider"
import { InteractionGraph } from "@/components/analytics/InteractionGraph"

export default function GraphPage() {
  return (
    <WSProvider>
      <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-label text-muted-foreground hover:text-foreground transition-colors"
            >
              ← dashboard
            </Link>
            <div className="w-px h-3 bg-border/60" />
            <span className="text-caption text-foreground">Interaction Graph</span>
          </div>
          <p className="text-label text-muted-foreground">
            force-directed · last 200 events · hover to inspect
          </p>
        </div>

        {/* Graph fills remaining height */}
        <div className="flex-1 relative min-h-0">
          <InteractionGraph />
        </div>
      </div>
    </WSProvider>
  )
}
