import { create } from "zustand"

type ConfigTab = "tank" | "fish" | "zones" | "schedules" | "layout"

interface UIStore {
  configOpen: boolean
  configTab: ConfigTab
  openConfig: (tab?: ConfigTab) => void
  closeConfig: () => void
  setConfigTab: (tab: ConfigTab) => void

  // Modal overlays — no page navigation
  fishModalId: string | null
  openFishModal: (id: string) => void
  closeFishModal: () => void

  graphOpen: boolean
  openGraph: () => void
  closeGraph: () => void

  timelineOpen: boolean
  openTimeline: () => void
  closeTimeline: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  configOpen: false,
  configTab: "fish",
  openConfig: (tab = "fish") => set({ configOpen: true, configTab: tab }),
  closeConfig: () => set({ configOpen: false }),
  setConfigTab: (tab) => set({ configTab: tab }),

  fishModalId: null,
  openFishModal: (id) => set({ fishModalId: id }),
  closeFishModal: () => set({ fishModalId: null }),

  graphOpen: false,
  openGraph: () => set({ graphOpen: true }),
  closeGraph: () => set({ graphOpen: false }),

  timelineOpen: false,
  openTimeline: () => set({ timelineOpen: true }),
  closeTimeline: () => set({ timelineOpen: false }),
}))
