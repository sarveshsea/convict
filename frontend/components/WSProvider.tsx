"use client"
import { useEffect } from "react"
import { convictWS } from "@/lib/ws"
import { useObservationStore } from "@/store/observationStore"
import { usePredictionStore } from "@/store/predictionStore"
import { useTankStore } from "@/store/tankStore"
import { useUIStore } from "@/store/uiStore"
import { getTank, listFish, getCommunityHealth } from "@/lib/api"
import type { WSMessage } from "@/lib/ws"

export function WSProvider({ children }: { children: React.ReactNode }) {
  const { setObservationFrame, setPipelineStatus, setCam2ObservationFrame } = useObservationStore()
  const { addAnomaly, upsertPrediction, setCommunityHealth } = usePredictionStore()
  const { setFish, setTank } = useTankStore()
  const bootstrapError    = useUIStore((s) => s.bootstrapError)
  const setBootstrapError = useUIStore((s) => s.setBootstrapError)

  useEffect(() => {
    // Bootstrap: load tank + fish + latest health snapshot before WS events
    // start flowing. If any of these fail, surface the error so the dashboard
    // doesn't silently look "loaded but empty" when the backend is down.
    const failures: string[] = []
    const trackFailure = (label: string) => (e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e)
      failures.push(`${label}: ${detail}`)
    }

    Promise.allSettled([
      getTank().then(setTank).catch(trackFailure("tank")),
      listFish().then(setFish).catch(trackFailure("fish")),
      getCommunityHealth(1)
        .then((r) => { if (r.current) setCommunityHealth(r.current as Parameters<typeof setCommunityHealth>[0]) })
        .catch(trackFailure("community health")),
    ]).then(() => {
      if (failures.length > 0) {
        setBootstrapError(`Backend unreachable — ${failures.join("; ")}`)
        // eslint-disable-next-line no-console
        console.error("[WSProvider] bootstrap failed:", failures)
      } else {
        setBootstrapError(null)
      }
    })

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
        listFish().then((f) => {
          setFish(f)
          // A successful refresh means the backend recovered — clear any
          // lingering bootstrap banner so the user knows things are fine now.
          if (useUIStore.getState().bootstrapError) setBootstrapError(null)
        }).catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn("[WSProvider] fish refresh failed:", e)
        })
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

  return (
    <>
      {bootstrapError && (
        <div className="fixed top-0 inset-x-0 z-[100] bg-rose-950/95 border-b border-rose-500/40 backdrop-blur-sm px-4 py-2 flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shrink-0" />
          <p className="text-caption text-rose-100 flex-1 truncate">{bootstrapError}</p>
          <button
            onClick={() => setBootstrapError(null)}
            className="text-label text-rose-300 hover:text-rose-100 px-2 py-0.5 rounded border border-rose-500/30 hover:border-rose-400 transition-colors shrink-0"
          >
            dismiss
          </button>
        </div>
      )}
      {children}
    </>
  )
}
