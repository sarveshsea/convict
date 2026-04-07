import { API_BASE } from "./constants"

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch {}
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// ---- Tank ----
export const getTank = () => request<Tank>("/api/v1/tank")
export const createTank = (data: TankCreate) =>
  request<Tank>("/api/v1/tank", { method: "POST", body: JSON.stringify(data) })
export const updateTank = (data: Partial<TankCreate>) =>
  request<Tank>("/api/v1/tank", { method: "PATCH", body: JSON.stringify(data) })

// ---- Fish ----
export const listFish = (includeInactive = false) =>
  request<KnownFish[]>(`/api/v1/tank/fish?include_inactive=${includeInactive}`)
export const createFish = (data: KnownFishCreate) =>
  request<KnownFish>("/api/v1/tank/fish", { method: "POST", body: JSON.stringify(data) })
export const updateFish = (uuid: string, data: Partial<KnownFishCreate>) =>
  request<KnownFish>(`/api/v1/tank/fish/${uuid}`, { method: "PUT", body: JSON.stringify(data) })
export const deleteFish = (uuid: string) =>
  request<void>(`/api/v1/tank/fish/${uuid}`, { method: "DELETE" })

// ---- Zones ----
export const listZones = () => request<Zone[]>("/api/v1/tank/zones")
export const createZone = (data: ZoneCreate) =>
  request<Zone>("/api/v1/tank/zones", { method: "POST", body: JSON.stringify(data) })
export const updateZone = (uuid: string, data: Partial<ZoneCreate>) =>
  request<Zone>(`/api/v1/tank/zones/${uuid}`, { method: "PUT", body: JSON.stringify(data) })
export const deleteZone = (uuid: string) =>
  request<void>(`/api/v1/tank/zones/${uuid}`, { method: "DELETE" })

// ---- Schedules ----
export const listSchedules = () => request<Schedule[]>("/api/v1/tank/schedules")
export const createSchedule = (data: ScheduleCreate) =>
  request<Schedule>("/api/v1/tank/schedules", { method: "POST", body: JSON.stringify(data) })
export const deleteSchedule = (uuid: string) =>
  request<void>(`/api/v1/tank/schedules/${uuid}`, { method: "DELETE" })

// ---- Stream / status ----
export const getStreamStatus = () => request<StreamStatus>("/api/v1/stream/status")
export const startPipeline = () => request<{status: string}>("/api/v1/stream/start", { method: "POST" })
export const stopPipeline = () => request<{status: string}>("/api/v1/stream/stop", { method: "POST" })

// ---- Observations ----
export const listEvents = (limit = 50, eventType?: string) =>
  request<BehaviorEvent[]>(`/api/v1/observations/events?limit=${limit}${eventType ? `&event_type=${eventType}` : ""}`)
export const listPatterns = () => request<BehaviorPattern[]>("/api/v1/observations/patterns")
export const listPredictions = (status = "active") =>
  request<PredictionItem[]>(`/api/v1/observations/predictions?status=${status}`)
export const resolvePrediction = (uuid: string, outcome: "resolved_correct" | "resolved_incorrect", notes?: string) =>
  request<{status: string}>(`/api/v1/observations/predictions/${uuid}/resolve?outcome=${outcome}${notes ? `&notes=${encodeURIComponent(notes)}` : ""}`, { method: "POST" })

// ---- Tank config (3D placement) ----
export const getTankConfig = () => request<TankConfig>("/api/v1/tank-config")
export const updateTankDimensions = (data: { width_cm?: number; height_cm?: number; depth_cm?: number }) =>
  request<TankDimensionsOut>("/api/v1/tank-config/dimensions", { method: "PUT", body: JSON.stringify(data) })
export const createCameraPlacement = (data: CameraIn) =>
  request<CameraOut>("/api/v1/tank-config/cameras", { method: "POST", body: JSON.stringify(data) })
export const deleteCameraPlacement = (uuid: string) =>
  request<void>(`/api/v1/tank-config/cameras/${uuid}`, { method: "DELETE" })
export const createObstacle = (data: ObstacleIn) =>
  request<ObstacleOut>("/api/v1/tank-config/obstacles", { method: "POST", body: JSON.stringify(data) })
export const updateObstacle = (uuid: string, data: ObstacleIn) =>
  request<ObstacleOut>(`/api/v1/tank-config/obstacles/${uuid}`, { method: "PUT", body: JSON.stringify(data) })
export const deleteObstacle = (uuid: string) =>
  request<void>(`/api/v1/tank-config/obstacles/${uuid}`, { method: "DELETE" })

// ---- Fish drilldown ----
export const getFishSummary = (uuid: string) =>
  request<FishSummary>(`/api/v1/tank/fish/${uuid}/summary`)
export const getFishZoneHeatmap = (uuid: string) =>
  request<{fish_uuid: string; zone_time_fractions: Record<string, number>}>(`/api/v1/tank/fish/${uuid}/zone-heatmap`)
export const getFishInteractionHistory = (uuid: string, limit = 30) =>
  request<BehaviorEvent[]>(`/api/v1/tank/fish/${uuid}/interaction-history?limit=${limit}`)
export const getFishConfidenceHistory = (uuid: string, limit = 60) =>
  request<ConfidencePoint[]>(`/api/v1/tank/fish/${uuid}/confidence-history?limit=${limit}`)

// ---- Types ----
export interface Tank {
  uuid: string; name: string; volume_gallons: number
  width_px: number; height_px: number; notes?: string
  created_at: string; updated_at: string
}
export interface TankCreate {
  name: string; volume_gallons: number
  width_px?: number; height_px?: number; notes?: string
}
export interface KnownFish {
  uuid: string; name: string; species: string; common_name?: string
  size_class: "small" | "medium" | "large"
  estimated_length_cm?: number
  temperament: "aggressive" | "semi-aggressive" | "peaceful"
  appearance_notes?: string; preferred_zones?: string[]
  date_added?: string; is_active: boolean
  auto_detected: boolean
  species_guess_confidence: number
  created_at: string; updated_at: string
}
export interface KnownFishCreate {
  name: string; species: string; common_name?: string
  size_class?: "small" | "medium" | "large"
  estimated_length_cm?: number
  temperament?: "aggressive" | "semi-aggressive" | "peaceful"
  appearance_notes?: string; preferred_zones?: string[]
  date_added?: string
}
export interface Zone {
  uuid: string; name: string
  x_min: number; y_min: number; x_max: number; y_max: number
  zone_type: "open" | "shelter" | "territory" | "feeding" | "surface" | "substrate"
  created_at: string
}
export interface ZoneCreate {
  name: string; x_min: number; y_min: number; x_max: number; y_max: number
  zone_type?: Zone["zone_type"]
}
export interface Schedule {
  uuid: string; event_type: string; time_of_day: string
  days_of_week?: number[]; notes?: string; created_at: string
}
export interface ScheduleCreate {
  event_type: "feeding" | "lights_on" | "lights_off" | "water_change"
  time_of_day: string; days_of_week?: number[]; notes?: string
}
export interface StreamStatus {
  running: boolean; camera_active: boolean
  detection_fps: number; inference_latency_ms: number
  track_count: number; identity_resolution_health: number
  queue_lag_frames: number
}
export interface BehaviorEvent {
  uuid: string; event_type: string; severity: "low" | "medium" | "high"
  occurred_at: string; involved_fish: {fish_id: string; fish_name: string}[]
  zone_id: string | null; duration_seconds: number | null; notes: string | null
}
export interface BehaviorPattern {
  uuid: string; pattern_type: string
  fish_id: string | null; fish_name: string | null
  confidence: number; signature: Record<string, unknown>
  first_seen_at: string; last_seen_at: string; occurrence_count: number
}
export interface PredictionItem {
  uuid: string; prediction_type: string; confidence: number
  horizon_minutes: number; involved_fish: {fish_id: string; fish_name: string}[]
  narrative: string; evidence_bundle_id: string | null
  expires_at: string; status: string
}
export interface FishSummary {
  fish: KnownFish
  baseline: {
    computed_at: string; zone_time_fractions: Record<string, number>
    mean_speed_px_per_frame: number; speed_stddev: number
    activity_by_hour: Record<string, number>; observation_frame_count: number
  } | null
  recent_events: BehaviorEvent[]
}
export interface ConfidencePoint { t: string; frames: number; mean_speed: number }

export interface TankDimensionsOut {
  uuid: string; name: string; width_cm: number | null; height_cm: number | null; depth_cm: number | null
}
export interface CameraIn {
  label: string; camera_index: number; wall: string; pos_u: number; pos_v: number; fov_degrees: number
}
export interface CameraOut extends CameraIn { uuid: string }
export interface ObstacleIn {
  label: string; x_frac: number; y_frac: number; z_frac: number
  w_frac: number; h_frac: number; d_frac: number; color: string; passable: boolean
}
export interface ObstacleOut extends ObstacleIn { uuid: string }
export interface TankConfig {
  tank: TankDimensionsOut; cameras: CameraOut[]; obstacles: ObstacleOut[]
}

export { ApiError }
