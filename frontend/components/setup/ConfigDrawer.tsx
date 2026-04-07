"use client"
import { useEffect } from "react"
import dynamic from "next/dynamic"
import { useUIStore } from "@/store/uiStore"
import { StepTank } from "./StepTank"
import { StepFish } from "./StepFish"
import { StepSchedules } from "./StepSchedules"
import { X } from "lucide-react"

const TankConfigurator3D = dynamic(
  () => import("@/components/tank/TankConfigurator3D").then(m => m.TankConfigurator3D),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Loading 3D…</span>
    </div>
  )},
)

const TABS = [
  { key: "fish" as const,      label: "Fish" },
  { key: "tank" as const,      label: "Tank" },
  { key: "zones" as const,     label: "Zones" },
  { key: "schedules" as const, label: "Schedules" },
  { key: "layout" as const,    label: "Layout" },
]

export function ConfigDrawer() {
  const { configOpen, configTab, closeConfig, setConfigTab } = useUIStore()

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeConfig()
    }
    if (configOpen) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [configOpen, closeConfig])

  function goTo(tab: typeof configTab) {
    setConfigTab(tab)
  }

  return (
    <>
      {/* Backdrop */}
      {configOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
          onClick={closeConfig}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full z-50 w-[480px] max-w-full flex flex-col
          bg-zinc-900 border-l border-border shadow-2xl
          transition-transform duration-200 ease-out
          ${configOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase block">Convict</span>
            <span className="text-sm font-medium tracking-tight">Tank Configuration</span>
          </div>
          <button
            onClick={closeConfig}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-surface"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 px-5 pt-3 border-b border-border shrink-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => goTo(t.key)}
              className={`px-3 py-1.5 text-[11px] font-mono border-b-2 -mb-px transition-colors
                ${configTab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={`flex-1 ${configTab === "layout" ? "flex flex-col overflow-hidden" : "overflow-y-auto px-5 py-5"}`}>
          {configTab === "tank" && (
            <StepTank onNext={() => goTo("zones")} />
          )}
          {configTab === "fish" && (
            <StepFish onNext={() => goTo("schedules")} onBack={() => goTo("zones")} />
          )}
          {configTab === "schedules" && (
            <StepSchedules onFinish={closeConfig} onBack={() => goTo("fish")} />
          )}
          {configTab === "layout" && (
            <TankConfigurator3D />
          )}
        </div>
      </div>
    </>
  )
}
