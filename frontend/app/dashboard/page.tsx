import { TopStrip } from "@/components/panels/TopStrip"
import { LeftPanel } from "@/components/panels/LeftPanel"
import { LiveFeedCanvas } from "@/components/feed/LiveFeedCanvas"
import { BottomRail } from "@/components/panels/BottomRail"
import { WSProvider } from "@/components/WSProvider"
import { FishModal } from "@/components/modals/FishModal"
import { GraphModal } from "@/components/modals/GraphModal"
import { TimelineModal } from "@/components/modals/TimelineModal"

export default function DashboardPage() {
  return (
    <WSProvider>
      <div className="h-screen flex overflow-hidden bg-background bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.18_0.03_245),oklch(0.08_0.005_245))]">
        {/* Persistent config sidebar */}
        <LeftPanel />

        {/* Video + HUD overlay */}
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <LiveFeedCanvas />
          </div>
          <div className="absolute inset-0 z-10 flex flex-col pointer-events-none">
            <TopStrip />
            <div className="flex-1" />
            <BottomRail />
          </div>
        </div>
      </div>

      {/* Modal overlays — no page navigation */}
      <FishModal />
      <GraphModal />
      <TimelineModal />
    </WSProvider>
  )
}
