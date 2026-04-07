import { create } from "zustand"
import type { Tank, KnownFish, Zone, Schedule } from "@/lib/api"

interface TankState {
  tank: Tank | null
  fish: KnownFish[]
  zones: Zone[]
  schedules: Schedule[]
  setTank: (t: Tank | null) => void
  setFish: (f: KnownFish[]) => void
  setZones: (z: Zone[]) => void
  setSchedules: (s: Schedule[]) => void
  addFish: (f: KnownFish) => void
  removeFish: (uuid: string) => void
  addZone: (z: Zone) => void
  removeZone: (uuid: string) => void
  addSchedule: (s: Schedule) => void
  removeSchedule: (uuid: string) => void
}

export const useTankStore = create<TankState>((set) => ({
  tank: null,
  fish: [],
  zones: [],
  schedules: [],
  setTank: (tank) => set({ tank }),
  setFish: (fish) => set({ fish }),
  setZones: (zones) => set({ zones }),
  setSchedules: (schedules) => set({ schedules }),
  addFish: (f) => set((s) => ({ fish: [...s.fish, f] })),
  removeFish: (uuid) => set((s) => ({ fish: s.fish.filter((f) => f.uuid !== uuid) })),
  addZone: (z) => set((s) => ({ zones: [...s.zones, z] })),
  removeZone: (uuid) => set((s) => ({ zones: s.zones.filter((z) => z.uuid !== uuid) })),
  addSchedule: (sc) => set((s) => ({ schedules: [...s.schedules, sc] })),
  removeSchedule: (uuid) => set((s) => ({ schedules: s.schedules.filter((sc) => sc.uuid !== uuid) })),
}))
