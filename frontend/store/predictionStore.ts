import { create } from "zustand"

export interface AnomalyItem {
  uuid: string
  event_type: string
  severity: "low" | "medium" | "high"
  involved_fish: { fish_id: string; fish_name: string }[]
  description: string
  zone_id: string | null
  started_at: string
}

export interface PredictionItem {
  uuid: string
  prediction_type: string
  confidence: number
  horizon_minutes: number
  involved_fish: { fish_id: string; fish_name: string }[]
  narrative: string
  evidence_bundle_id: string
  expires_at: string
  status: "active" | "resolved_correct" | "resolved_incorrect" | "expired"
}

interface PredictionState {
  anomalies: AnomalyItem[]
  predictions: PredictionItem[]
  addAnomaly: (a: AnomalyItem) => void
  upsertPrediction: (p: PredictionItem) => void
  clearExpired: () => void
}

export const usePredictionStore = create<PredictionState>((set) => ({
  anomalies: [],
  predictions: [],
  addAnomaly: (a) =>
    set((s) => ({
      anomalies: [a, ...s.anomalies].slice(0, 50),  // keep last 50
    })),
  upsertPrediction: (p) =>
    set((s) => {
      const idx = s.predictions.findIndex((x) => x.uuid === p.uuid)
      if (idx >= 0) {
        const next = [...s.predictions]
        next[idx] = p
        return { predictions: next }
      }
      return { predictions: [p, ...s.predictions] }
    }),
  clearExpired: () =>
    set((s) => ({
      predictions: s.predictions.filter(
        (p) => p.status === "active" && new Date(p.expires_at) > new Date()
      ),
    })),
}))
