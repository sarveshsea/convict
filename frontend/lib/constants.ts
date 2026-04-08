export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/api/v1/stream/ws"
export const STREAM_URL  = `${API_BASE}/api/v1/stream/video`
export const STREAM_URL_2 = `${API_BASE}/api/v1/stream/video2`

/** HLS playlist URLs — served from /tmp/convict_hls by the backend.
 *  Requires ffmpeg on the backend host and the hls.js package on the frontend.
 *  Install hls.js: `npm install hls.js` (and `npm install --save-dev @types/hls.js`)
 */
export const HLS_URL   = `${API_BASE}/api/v1/stream/hls/stream.m3u8`
export const HLS_URL_2 = `${API_BASE}/api/v1/stream/hls2/stream.m3u8`

/** Backend endpoint to probe HLS availability before mounting the player. */
export const HLS_STATUS_URL = `${API_BASE}/api/v1/stream/hls-status`

/** Latest saved profile crop for a known fish (backend writes snapshots periodically). */
export function fishSnapshotUrl(fishUuid: string, cacheBust?: string | number) {
  const q = cacheBust != null ? `?t=${cacheBust}` : ""
  return `${API_BASE}/api/v1/tank/fish/${fishUuid}/snapshot${q}`
}

// ─── Shared color maps (single source of truth) ──────────────────────────────

export const PREDICTION_COLORS: Record<string, string> = {
  aggression_escalation: "text-rose-400 border-rose-400/30 bg-rose-400/5",
  isolation_trend:       "text-amber-400 border-amber-400/30 bg-amber-400/5",
  territory_shift:       "text-blue-400 border-blue-400/30 bg-blue-400/5",
  schooling_break:       "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
  feeding_disruption:    "text-orange-400 border-orange-400/30 bg-orange-400/5",
  water_quality_alert:   "text-rose-500 border-rose-500/40 bg-rose-500/10",
  disease_early_warning: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  spawning_imminent:     "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
  circadian_disruption:  "text-indigo-400 border-indigo-400/30 bg-indigo-400/5",
}

export const SEVERITY_COLORS: Record<string, string> = {
  high:   "text-rose-400 border-rose-400/30 bg-rose-400/5",
  medium: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  low:    "text-zinc-400 border-zinc-400/30 bg-zinc-400/5",
}

export const TEMP_COLOR: Record<string, string> = {
  aggressive:        "bg-rose-500",
  "semi-aggressive": "bg-amber-400",
  peaceful:          "bg-blue-400",
}

export const TEMP_TEXT_COLOR: Record<string, string> = {
  aggressive:        "text-rose-400 border-rose-400/30 bg-rose-400/5",
  "semi-aggressive": "text-amber-400 border-amber-400/30 bg-amber-400/5",
  peaceful:          "text-blue-400 border-blue-400/30 bg-blue-400/5",
}

export const EVENT_DOT: Record<string, string> = {
  chase:        "bg-rose-500",
  harassment:   "bg-rose-400",
  hiding:       "bg-amber-400",
  missing_fish: "bg-rose-500 animate-pulse",
  schooling:    "bg-emerald-400",
  lethargy:     "bg-amber-400",
  dispersion:   "bg-zinc-400",
  vlm_observation: "bg-blue-400",
}

/** Canvas drawing colors shared across BehaviorBaseline, SpeedHistoryChart, ZoneHeatmap */
export const CANVAS_COLORS = {
  bg:      "#0a0a0f",
  grid:    "rgba(63,63,70,0.4)",
  text:    "#52525b",
  primary: "rgba(96,165,250,0.85)",
  fill:    "rgba(96,165,250,0.12)",
  muted:   "rgba(96,165,250,0.3)",
}
