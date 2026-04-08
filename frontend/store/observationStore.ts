import { create } from "zustand"

export interface EntityIdentity {
  fish_id: string | null
  fish_name: string | null
  species: string | null
  confidence: number
  is_confirmed: boolean
}

export interface LiveEntity {
  track_id: number
  bbox: [number, number, number, number]   // x1, y1, x2, y2 absolute pixels
  centroid: [number, number]
  confidence: number
  identity: EntityIdentity
  zone_ids: string[]
  speed_px_per_frame: number
  trail: [number, number][]
}

export interface PipelineStatus {
  running: boolean
  camera_active: boolean
  cam2_active: boolean
  detection_fps: number
  inference_latency_ms: number
  track_count: number
  identity_resolution_health: number
  queue_lag_frames: number
  camera_restarting?: boolean
}

interface ObservationState {
  entities: LiveEntity[]
  frameSeq: number
  frameWidth: number
  frameHeight: number
  scheduleContext: string | null
  nightMode: boolean
  pipeline: PipelineStatus
  cam2Entities: LiveEntity[]
  cam2FrameWidth: number
  cam2FrameHeight: number
  setObservationFrame: (entities: LiveEntity[], seq: number, ctx: string | null, fw: number, fh: number, nightMode: boolean) => void
  setPipelineStatus: (status: PipelineStatus) => void
  setCam2ObservationFrame: (entities: LiveEntity[], fw: number, fh: number) => void
}

const defaultPipeline: PipelineStatus = {
  running: false, camera_active: false, cam2_active: false,
  detection_fps: 0, inference_latency_ms: 0,
  track_count: 0, identity_resolution_health: 0,
  queue_lag_frames: 0,
}

export const useObservationStore = create<ObservationState>((set) => ({
  entities: [],
  frameSeq: 0,
  frameWidth: 1280,
  frameHeight: 720,
  scheduleContext: null,
  nightMode: false,
  pipeline: defaultPipeline,
  cam2Entities: [],
  cam2FrameWidth: 1280,
  cam2FrameHeight: 720,
  setObservationFrame: (entities, seq, ctx, fw, fh, nightMode) =>
    set({ entities, frameSeq: seq, scheduleContext: ctx, frameWidth: fw, frameHeight: fh, nightMode }),
  setPipelineStatus: (pipeline) => set({ pipeline }),
  setCam2ObservationFrame: (cam2Entities, cam2FrameWidth, cam2FrameHeight) =>
    set({ cam2Entities, cam2FrameWidth, cam2FrameHeight }),
}))
