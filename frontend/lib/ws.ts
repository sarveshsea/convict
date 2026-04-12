"use client"
import { WS_URL } from "./constants"
import type { LiveEntity, PipelineStatus } from "@/store/observationStore"
import type { AnomalyItem, PredictionItem, CommunityHealth } from "@/store/predictionStore"

// ── Payload shapes ────────────────────────────────────────────────────────────

export interface ObservationFramePayload {
  entities?: LiveEntity[]
  camera_index?: number
  frame_width?: number
  frame_height?: number
  schedule_context?: string | null
  night_mode?: boolean
}

export interface VLMAnalysisPayload {
  anomalies?: AnomalyItem[]
}

export interface FishUpdatedPayload {
  reason?: string
}

// ── Discriminated union of all server messages ───────────────────────────────

export type WSMessage =
  | { type: "observation_frame"; timestamp: string; seq: number; payload: ObservationFramePayload }
  | { type: "pipeline_status";   timestamp: string; seq: number; payload: PipelineStatus }
  | { type: "anomaly_flagged";   timestamp: string; seq: number; payload: AnomalyItem }
  | { type: "prediction_created"; timestamp: string; seq: number; payload: PredictionItem }
  | { type: "prediction_updated"; timestamp: string; seq: number; payload: PredictionItem }
  | { type: "fish_updated";      timestamp: string; seq: number; payload: FishUpdatedPayload }
  | { type: "vlm_analysis";      timestamp: string; seq: number; payload: VLMAnalysisPayload }
  | { type: "community_health";  timestamp: string; seq: number; payload: CommunityHealth }

export type WSMessageType = WSMessage["type"]

type Listener = (msg: WSMessage) => void

class ConvictWS {
  private ws: WebSocket | null = null
  private listeners = new Map<WSMessageType, Set<Listener>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldConnect = false

  connect() {
    this.shouldConnect = true
    this._open()
  }

  disconnect() {
    this.shouldConnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  on<K extends WSMessageType>(
    type: K,
    fn: (msg: Extract<WSMessage, { type: K }>) => void,
  ): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    const wrapped: Listener = (msg) => {
      if (msg.type === type) fn(msg as Extract<WSMessage, { type: K }>)
    }
    this.listeners.get(type)!.add(wrapped)
    return () => {
      this.listeners.get(type)?.delete(wrapped)
    }
  }

  private _open() {
    if (typeof window === "undefined") return
    this.ws = new WebSocket(WS_URL)

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage
        this.listeners.get(msg.type)?.forEach((fn) => fn(msg))
      } catch {}
    }

    this.ws.onclose = () => {
      if (this.shouldConnect) {
        // Jitter prevents thundering herd when backend restarts
        const delay = 2000 + Math.random() * 2000
        this.reconnectTimer = setTimeout(() => this._open(), delay)
      }
    }

    this.ws.onerror = () => this.ws?.close()
  }
}

export const convictWS = new ConvictWS()
