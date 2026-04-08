"use client"
import { WS_URL } from "./constants"

export type WSMessageType =
  | "observation_frame"
  | "identity_update"
  | "anomaly_flagged"
  | "prediction_created"
  | "prediction_updated"
  | "fish_updated"
  | "event_detected"
  | "pipeline_status"
  | "baseline_updated"
  | "vlm_analysis"

export interface WSMessage<T = unknown> {
  type: WSMessageType
  timestamp: string
  seq: number
  payload: T
}

type Listener<T = unknown> = (msg: WSMessage<T>) => void

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

  on<T>(type: WSMessageType, fn: Listener<T>) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn as Listener)
    return () => this.listeners.get(type)?.delete(fn as Listener)
  }

  private _open() {
    if (typeof window === "undefined") return
    this.ws = new WebSocket(WS_URL)

    this.ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
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
