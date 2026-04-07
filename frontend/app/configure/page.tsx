"use client"
import dynamic from "next/dynamic"

// Three.js requires browser APIs — SSR must be disabled
const TankConfigurator3D = dynamic(
  () => import("@/components/tank/TankConfigurator3D").then(m => m.TankConfigurator3D),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center bg-zinc-950">
      <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Loading 3D…</span>
    </div>
  )},
)

export default function ConfigurePage() {
  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Convict</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[10px] font-mono text-zinc-300 uppercase tracking-widest">Tank configurator</span>
        </div>
        <p className="text-[9px] font-mono text-zinc-600">
          Drag to rotate · scroll to zoom · right-drag to pan
        </p>
      </header>
      <div className="flex-1 overflow-hidden">
        <TankConfigurator3D />
      </div>
    </div>
  )
}
