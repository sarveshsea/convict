export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/api/v1/stream/ws"
export const STREAM_URL  = `${API_BASE}/api/v1/stream/video`
export const STREAM_URL_2 = `${API_BASE}/api/v1/stream/video2`
