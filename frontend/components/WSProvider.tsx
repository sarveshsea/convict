"use client"
import { useEffect } from "react"
import { convictWS } from "@/lib/ws"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"
import { getTank, listFish, getCommunityHealth } from "@/lib/api"
import type { WSMessage } from "@/lib/ws"

export function WSProvider({ children }: { children: React.ReactNode }) {
  const { setObservationFrame, setPipelineStatus, setCam2ObservationFrame } = useObservationStore()
  const { addAnomaly, upsertPrediction, setCommunityHealth } = usePredictionStore()
  const { setFish, setTank } = useTankStore()

  useEffect(() => {
    // Bootstrap: load tank + fish + latest health snapshot before WS events start flowing
    getTank().then(setTank).catch(() => {})
    listFish().then(setFish).catch(() => {})
    getCommunityHealth(1).then((r) => { if (r.current) setCommunityHealth(r.current as any) }).catch(() => {})

    convictWS.connect()

    const unsubs = [
      convictWS.on<any>("observation_frame", (msg: WSMessage<any>) => {
        const knownFish = useTankStore.getState().fish
        const enriched = (msg.payload.entities ?? []).map((e: any) => {
          if (e.identity?.fish_id) {
            const f = knownFish.find((kf) => kf.uuid === e.identity.fish_id)
            if (f) return { ...e, identity: { ...e.identity, species: f.species ?? null } }
          }
          return e
        })
        const camIdx = msg.payload.camera_index ?? 0
        if (camIdx === 1) {
          setCam2ObservationFrame(
            enriched,
            msg.payload.frame_width  ?? 1280,
            msg.payload.frame_height ?? 720,
          )
        } else {
          setObservationFrame(
            enriched,
            msg.seq,
            msg.payload.schedule_context ?? null,
            msg.payload.frame_width  ?? 1280,
            msg.payload.frame_height ?? 720,
            msg.payload.night_mode   ?? false,
          )
        }
      }),
      convictWS.on<any>("pipeline_status", (msg: WSMessage<any>) => {
        setPipelineStatus(msg.payload)
      }),
      convictWS.on<any>("anomaly_flagged", (msg: WSMessage<any>) => {
        addAnomaly(msg.payload)
      }),
      convictWS.on<any>("prediction_created", (msg: WSMessage<any>) => {
        upsertPrediction(msg.payload)
      }),
      convictWS.on<any>("prediction_updated", (msg: WSMessage<any>) => {
        upsertPrediction(msg.payload)
      }),
      convictWS.on<any>("fish_updated", () => {
        // Auto-detected fish created or species guessed — refresh the roster
        listFish().then((f) => setFish(f)).catch(() => {})
      }),
      convictWS.on<any>("vlm_analysis", (msg: WSMessage<any>) => {
        // Feed VLM anomalies into the prediction store so they appear in the Intel tab
        if (msg.payload?.anomalies?.length) {
          msg.payload.anomalies.forEach((a: any) => addAnomaly(a))
        }
        // Signal TopStrip badge — fires the DOM event it listens for
        window.dispatchEvent(new CustomEvent("vlm_analysis"))
      }),
      convictWS.on<any>("community_health", (msg: WSMessage<any>) => {
        if (msg.payload) setCommunityHealth(msg.payload)
      }),
    ]

    return () => {
      unsubs.forEach((fn) => fn())
      convictWS.disconnect()
    }
  }, [])

  return <>{children}</>
}
