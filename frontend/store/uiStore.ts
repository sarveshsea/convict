import { create } from "zustand"

type ConfigTab = "tank" | "fish" | "zones" | "schedules" | "layout"

interface UIStore {
  configOpen: boolean
  configTab: ConfigTab
  openConfig: (tab?: ConfigTab) => void
  closeConfig: () => void
  setConfigTab: (tab: ConfigTab) => void
}

export const useUIStore = create<UIStore>((set) => ({
  configOpen: false,
  configTab: "fish",
  openConfig: (tab = "fish") => set({ configOpen: true, configTab: tab }),
  closeConfig: () => set({ configOpen: false }),
  setConfigTab: (tab) => set({ configTab: tab }),
}))
