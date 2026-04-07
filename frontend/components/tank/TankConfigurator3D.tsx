"use client"

import { Suspense, useCallback, useEffect, useState, useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  getTankConfig, updateTankDimensions,
  createCameraPlacement, deleteCameraPlacement,
  createObstacle, deleteObstacle, updateObstacle,
} from "@/lib/api"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, Edges, GizmoHelper, GizmoViewport, Html, Line } from "@react-three/drei"
import * as THREE from "three"
import { STREAM_URL, STREAM_URL_2 } from "@/lib/constants"
import { useObservationStore } from "@/store/observationStore"
import type { LiveEntity } from "@/store/observationStore"
import { projectFishTo3D } from "@/lib/fishProjection"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TankDims {
  widthCm: number
  heightCm: number
  depthCm: number
}

export interface CamPlacement {
  id: string
  label: string
  camIndex: number
  wall: "front" | "back" | "left" | "right" | "top"
  posU: number
  posV: number
  fovDeg: number
}

export interface TankObstacle {
  id: string
  label: string
  color: string
  xF: number; yF: number; zF: number
  wF: number; hF: number; dF: number
  passable: boolean
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function wallPosition(
  wall: string, u: number, v: number,
  w: number, h: number, d: number,
): [number, number, number] {
  const off = Math.min(w, h, d) * 0.04
  switch (wall) {
    case "front":  return [(u - 0.5) * w, (v - 0.5) * h, d / 2 + off]
    case "back":   return [(u - 0.5) * w, (v - 0.5) * h, -d / 2 - off]
    case "left":   return [-w / 2 - off, (v - 0.5) * h, (u - 0.5) * d]
    case "right":  return [w / 2 + off,  (v - 0.5) * h, (u - 0.5) * d]
    case "top":    return [(u - 0.5) * w, h / 2 + off,  (v - 0.5) * d]
    default:       return [0, 0, 0]
  }
}

function wallRotation(wall: string): [number, number, number] {
  switch (wall) {
    case "front":  return [0, Math.PI, 0]
    case "back":   return [0, 0, 0]
    case "left":   return [0, -Math.PI / 2, 0]
    case "right":  return [0,  Math.PI / 2, 0]
    case "top":    return [Math.PI / 2, 0, 0]
    default:       return [0, 0, 0]
  }
}

function pointToUV(
  wall: string, point: THREE.Vector3,
  w: number, h: number, d: number,
): [number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  switch (wall) {
    case "front":
    case "back":  return [clamp((point.x + w / 2) / w), clamp((point.y + h / 2) / h)]
    case "left":  return [clamp((point.z + d / 2) / d), clamp((point.y + h / 2) / h)]
    case "right": return [clamp((d / 2 - point.z) / d), clamp((point.y + h / 2) / h)]
    case "top":   return [clamp((point.x + w / 2) / w), clamp((d / 2 - point.z) / d)]
    default:      return [0.5, 0.5]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function streamUrl(camIndex: number): string {
  return camIndex === 0 ? STREAM_URL : STREAM_URL_2
}

// ─── 3D components ────────────────────────────────────────────────────────────

function TankBox({ w, h, d }: { w: number; h: number; d: number }) {
  return (
    <>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial transparent opacity={0} />
        <Edges color="#3B82F6" linewidth={1.5} />
      </mesh>
      {/* Water volume */}
      <mesh>
        <boxGeometry args={[w * 0.999, h * 0.999, d * 0.999]} />
        <meshBasicMaterial color="#1E3A5F" transparent opacity={0.07} side={THREE.FrontSide} />
      </mesh>
    </>
  )
}

function WallPlane({
  wallId, position, rotation, args, tankW, tankH, tankD, onPlace,
}: {
  wallId: string
  position: [number, number, number]
  rotation: [number, number, number]
  args: [number, number]
  tankW: number; tankH: number; tankD: number
  onPlace: (wall: string, u: number, v: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <mesh
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation()
        const [u, v] = pointToUV(wallId, e.point, tankW, tankH, tankD)
        onPlace(wallId, u, v)
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={args} />
      <meshBasicMaterial
        transparent
        opacity={hovered ? 0.14 : 0.03}
        color="#60A5FA"
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function WallTargets({
  w, h, d, onPlace,
}: {
  w: number; h: number; d: number
  onPlace: (wall: string, u: number, v: number) => void
}) {
  const walls = [
    { id: "front",  pos: [0, 0,  d / 2] as [number,number,number], rot: [0, 0, 0] as [number,number,number], args: [w, h] as [number,number] },
    { id: "back",   pos: [0, 0, -d / 2] as [number,number,number], rot: [0, 0, 0] as [number,number,number], args: [w, h] as [number,number] },
    { id: "left",   pos: [-w / 2, 0, 0] as [number,number,number], rot: [0, Math.PI / 2, 0] as [number,number,number], args: [d, h] as [number,number] },
    { id: "right",  pos: [w / 2,  0, 0] as [number,number,number], rot: [0, Math.PI / 2, 0] as [number,number,number], args: [d, h] as [number,number] },
    { id: "top",    pos: [0, h / 2, 0]  as [number,number,number], rot: [Math.PI / 2, 0, 0] as [number,number,number], args: [w, d] as [number,number] },
  ]
  return (
    <>
      {walls.map(wl => (
        <WallPlane
          key={wl.id} wallId={wl.id}
          position={wl.pos} rotation={wl.rot} args={wl.args}
          tankW={w} tankH={h} tankD={d} onPlace={onPlace}
        />
      ))}
    </>
  )
}

/** World-space unit vector pointing away from the tank for each wall. */
function wallOutward(wall: string): [number, number, number] {
  switch (wall) {
    case "front":  return [0, 0,  1]
    case "back":   return [0, 0, -1]
    case "left":   return [-1, 0, 0]
    case "right":  return [ 1, 0, 0]
    case "top":    return [0,  1, 0]
    default:       return [0,  0,  1]
  }
}

function CameraIcon({ cam, w, h, d }: { cam: CamPlacement; w: number; h: number; d: number }) {
  const pos  = wallPosition(cam.wall, cam.posU, cam.posV, w, h, d)
  const rot  = wallRotation(cam.wall)
  const size = Math.min(w, h, d) * 0.07

  // Thumbnail floats outside the wall the camera is mounted on
  const out  = wallOutward(cam.wall)
  const push = Math.min(w, h, d) * 1.4
  // Lift horizontal-wall thumbnails slightly so they clear the camera body
  const liftY = out[1] === 0 ? size * 3 : 0
  const thumbPos: [number, number, number] = [
    pos[0] + out[0] * push,
    pos[1] + out[1] * push + liftY,
    pos[2] + out[2] * push,
  ]

  return (
    <>
      {/* Camera body in wall-local space */}
      <group position={pos} rotation={rot}>
        {/* Body */}
        <mesh>
          <boxGeometry args={[size * 1.8, size, size * 0.9]} />
          <meshStandardMaterial color="#F97316" metalness={0.4} roughness={0.3} />
        </mesh>
        {/* Lens barrel */}
        <mesh position={[0, 0, size * 0.95]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[size * 0.32, size * 0.42, size * 0.7, 12]} />
          <meshStandardMaterial color="#111" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* FOV ghost cone */}
        <mesh position={[0, 0, size * 5]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[size * 3, size * 8, 4, 1, true]} />
          <meshBasicMaterial color="#F97316" transparent opacity={0.05} side={THREE.DoubleSide} wireframe />
        </mesh>
        {/* Label */}
        <Html position={[0, size * 1.2, 0]} center style={{ pointerEvents: "none" }}>
          <span style={{
            fontSize: 9, color: "#FB923C", fontFamily: "monospace",
            background: "rgba(0,0,0,0.75)", padding: "1px 5px", borderRadius: 2, whiteSpace: "nowrap",
          }}>
            {cam.label}
          </span>
        </Html>
      </group>

      {/* Tether: camera body → thumbnail */}
      <Line
        points={[pos as [number, number, number], thumbPos]}
        color="#F97316"
        lineWidth={0.8}
        transparent
        opacity={0.28}
      />

      {/* Live feed thumbnail — outside the wall, not overlapping the tank */}
      <group position={thumbPos}>
        <Html center style={{ pointerEvents: "none" }}>
          <div style={{
            width: 110,
            border: "1.5px solid rgba(249,115,22,0.6)",
            borderRadius: 6,
            overflow: "hidden",
            background: "#09090b",
            boxShadow: "0 4px 18px rgba(0,0,0,0.85), 0 0 0 1px rgba(249,115,22,0.10)",
          }}>
            <img
              src={streamUrl(cam.camIndex)}
              style={{ width: "100%", aspectRatio: "16/9", display: "block", objectFit: "cover" }}
              alt=""
            />
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "3px 6px",
              background: "rgba(9,9,11,0.92)",
              borderTop: "1px solid rgba(249,115,22,0.18)",
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "#F97316", flexShrink: 0,
                boxShadow: "0 0 4px rgba(249,115,22,0.7)",
              }} />
              <span style={{ fontSize: 8, color: "#FB923C", fontFamily: "monospace", letterSpacing: "0.08em" }}>
                CAM {cam.camIndex + 1}
              </span>
            </div>
          </div>
        </Html>
      </group>
    </>
  )
}

function ObstacleBox({ obs, w, h, d }: { obs: TankObstacle; w: number; h: number; d: number }) {
  return (
    <mesh position={[
      (obs.xF - 0.5) * w,
      (obs.yF - 0.5) * h,
      (obs.zF - 0.5) * d,
    ]}>
      <boxGeometry args={[obs.wF * w, obs.hF * h, obs.dF * d]} />
      <meshStandardMaterial color={obs.color} transparent opacity={0.75} roughness={0.85} />
      <Edges color={obs.color} />
    </mesh>
  )
}

// ─── Live fish helpers ────────────────────────────────────────────────────────

function entityColor(identity: LiveEntity["identity"]): string {
  const species = identity?.species
  if (!species || species === "Unknown" || species === "") return "#71717a"
  if (species.startsWith("Possible: ")) return "#fbbf24"
  const conf = identity?.confidence ?? 0
  if (conf >= 0.7) return "#34d399"
  if (conf >= 0.4) return "#fbbf24"
  return "#f43f5e"
}

function isScanning(identity: LiveEntity["identity"]): boolean {
  const s = identity?.species
  return !s || s === "Unknown" || s === ""
}

function FishMarker3D({
  entity, pos, dims, color,
}: {
  entity: LiveEntity
  pos: [number, number, number]
  dims: TankDims
  color: string
}) {
  const [x, y, z] = pos
  const floorY = -dims.heightCm / 2
  const SPHERE_R = 3.5

  const scanning = isScanning(entity.identity)
  const label = !scanning && entity.identity.fish_name
    ? `${entity.identity.fish_name} ${((entity.identity.confidence ?? 0) * 100).toFixed(0)}%`
    : null

  return (
    <group>
      <mesh position={[x, y, z]}>
        <sphereGeometry args={[SPHERE_R, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          transparent
          opacity={0.92}
        />
      </mesh>
      {/* Vertical drop line to tank floor — indicates depth ambiguity */}
      <Line
        points={[[x, y, z], [x, floorY, z]]}
        color={color}
        lineWidth={1}
        transparent
        opacity={0.28}
      />
      {label && (
        <Html position={[x, y + SPHERE_R + 2, z]} center style={{ pointerEvents: "none" }}>
          <span style={{
            fontSize: 9, color, fontFamily: "monospace",
            background: "rgba(0,0,0,0.78)", padding: "1px 5px",
            borderRadius: 2, whiteSpace: "nowrap",
          }}>
            {label}
          </span>
        </Html>
      )}
    </group>
  )
}

function FishTrail3D({
  trail, frameW, frameH, cam, dims, color,
}: {
  trail: [number, number][]
  frameW: number
  frameH: number
  cam: CamPlacement
  dims: TankDims
  color: string
}) {
  const projected = trail
    .map(pt => projectFishTo3D(pt, frameW, frameH, cam, dims))
    .filter((p): p is [number, number, number] => p !== null)

  if (projected.length < 2) return null

  const n = projected.length
  const c = new THREE.Color(color)
  const vertexColors = projected.map((_, i) =>
    [c.r, c.g, c.b].map(ch => ch * (0.1 + 0.9 * (i / (n - 1)))) as [number, number, number]
  )

  return (
    <Line
      points={projected}
      vertexColors={vertexColors}
      lineWidth={1.2}
    />
  )
}

function LiveFish3D({
  entities, frameWidth, frameHeight, cameras, dims,
}: {
  entities: LiveEntity[]
  frameWidth: number
  frameHeight: number
  cameras: CamPlacement[]
  dims: TankDims
}) {
  const primaryCam = cameras.find(c => c.camIndex === 0) ?? null
  if (!primaryCam || entities.length === 0) return null

  return (
    <>
      {entities.map(entity => {
        const pos = projectFishTo3D(entity.centroid, frameWidth, frameHeight, primaryCam, dims)
        if (!pos) return null
        const color = entityColor(entity.identity)
        return (
          <group key={entity.track_id}>
            <FishMarker3D entity={entity} pos={pos} dims={dims} color={color} />
            {entity.trail.length >= 2 && (
              <FishTrail3D
                trail={entity.trail}
                frameW={frameWidth}
                frameH={frameHeight}
                cam={primaryCam}
                dims={dims}
                color={color}
              />
            )}
          </group>
        )
      })}
    </>
  )
}

function Scene({
  dims, cameras, obstacles, placingCamera, onWallPlace,
  showLive, liveEntities, frameWidth, frameHeight,
}: {
  dims: TankDims
  cameras: CamPlacement[]
  obstacles: TankObstacle[]
  placingCamera: boolean
  onWallPlace: (wall: string, u: number, v: number) => void
  showLive: boolean
  liveEntities: LiveEntity[]
  frameWidth: number
  frameHeight: number
}) {
  const { widthCm: w, heightCm: h, depthCm: d } = dims
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[w * 2, h * 3, d * 2]} intensity={0.9} />
      <TankBox w={w} h={h} d={d} />
      {placingCamera && <WallTargets w={w} h={h} d={d} onPlace={onWallPlace} />}
      {cameras.map(c => <CameraIcon key={c.id} cam={c} w={w} h={h} d={d} />)}
      {obstacles.map(o => <ObstacleBox key={o.id} obs={o} w={w} h={h} d={d} />)}
      {showLive && (
        <LiveFish3D
          entities={liveEntities}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          cameras={cameras}
          dims={dims}
        />
      )}
      <gridHelper
        args={[Math.max(w, d) * 2, 24, "#18181B", "#18181B"]}
        position={[0, -h / 2, 0]}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewport axisColors={["#EF4444", "#22C55E", "#3B82F6"]} labelColor="white" />
      </GizmoHelper>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const OBS_COLORS = ["#8B6914", "#4A4A4A", "#2D5A27", "#7A3A3A", "#3A4A7A", "#1A5F5F"]

const CM_PER_IN = 2.54
const toIn = (cm: number) => Math.round((cm / CM_PER_IN) * 10) / 10
const toCm = (inches: number) => Math.round(inches * CM_PER_IN * 10) / 10
const cubicInchesToGallons = (w: number, h: number, d: number) =>
  ((w * h * d) / 231).toFixed(1)

function DimInput({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} step={0.5} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
        />
        <span className="text-xs text-zinc-600 font-mono shrink-0">in</span>
      </div>
    </label>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// uuid maps: local id → server uuid (populated after load/save)
const camUuidMap = new Map<string, string>()
const obsUuidMap = new Map<string, string>()

export function TankConfigurator3D() {
  // dims stored in inches in UI; converted to/from cm for the backend
  const [dims, setDims] = useState<TankDims>({ widthCm: toIn(90), heightCm: toIn(45), depthCm: toIn(45) })
  const [cameras, setCameras] = useState<CamPlacement[]>([])
  const [obstacles, setObstacles] = useState<TankObstacle[]>([])
  const [placingCamera, setPlacingCamera] = useState(false)
  const [pending, setPending] = useState<{ wall: string; u: number; v: number } | null>(null)
  const [camLabel, setCamLabel] = useState("Camera 1")
  const [camIndex, setCamIndex] = useState(0)
  const [showObsForm, setShowObsForm] = useState(false)
  const [newObs, setNewObs] = useState({
    label: "Driftwood", color: OBS_COLORS[0],
    xF: 0.5, yF: 0.25, zF: 0.5,
    wF: 0.25, hF: 0.35, dF: 0.15,
  })
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle")
  const [showLive, setShowLive] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editingCamId, setEditingCamId] = useState<string | null>(null)
  const [replacingCamId, setReplacingCamId] = useState<string | null>(null)

  // Live entity data from the observation pipeline
  const liveEntities = useObservationStore(s => s.entities)
  const frameWidth   = useObservationStore(s => s.frameWidth)
  const frameHeight  = useObservationStore(s => s.frameHeight)

  // Load existing config on mount
  useEffect(() => {
    getTankConfig().then(cfg => {
      setDims({
        widthCm:  toIn(cfg.tank.width_cm  ?? 90),
        heightCm: toIn(cfg.tank.height_cm ?? 45),
        depthCm:  toIn(cfg.tank.depth_cm  ?? 45),
      })
      const loadedCams: CamPlacement[] = cfg.cameras.map(c => {
        const localId = crypto.randomUUID()
        camUuidMap.set(localId, c.uuid)
        return {
          id: localId, label: c.label, camIndex: c.camera_index,
          wall: c.wall as CamPlacement["wall"],
          posU: c.pos_u, posV: c.pos_v, fovDeg: c.fov_degrees,
        }
      })
      const loadedObs: TankObstacle[] = cfg.obstacles.map(o => {
        const localId = crypto.randomUUID()
        obsUuidMap.set(localId, o.uuid)
        return {
          id: localId, label: o.label, color: o.color, passable: o.passable,
          xF: o.x_frac, yF: o.y_frac, zF: o.z_frac,
          wF: o.w_frac, hF: o.h_frac, dF: o.d_frac,
        }
      })
      setCameras(loadedCams)
      setObstacles(loadedObs)
    }).catch(() => { /* no tank yet — use defaults */ })
  }, [])

  const handleWallPlace = useCallback((wall: string, u: number, v: number) => {
    setPlacingCamera(false)
    setReplacingCamId(prev => {
      if (prev) {
        setCameras(p => p.map(c => c.id === prev
          ? { ...c, wall: wall as CamPlacement["wall"], posU: u, posV: v }
          : c
        ))
        return null
      }
      setPending({ wall, u, v })
      return null
    })
  }, [])

  const confirmCamera = () => {
    if (!pending) return
    setCameras(p => [...p, {
      id: crypto.randomUUID(),
      label: camLabel,
      camIndex,
      wall: pending.wall as CamPlacement["wall"],
      posU: pending.u,
      posV: pending.v,
      fovDeg: 78,
    }])
    setPending(null)
    setCamLabel(`Camera ${cameras.length + 2}`)
  }

  const addObstacle = () => {
    setObstacles(p => [...p, { id: crypto.randomUUID(), passable: false, ...newObs }])
    setShowObsForm(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // 1. Dimensions
      await updateTankDimensions({ width_cm: toCm(dims.widthCm), height_cm: toCm(dims.heightCm), depth_cm: toCm(dims.depthCm) })

      // 2. Cameras — delete all server records then re-create from current state
      for (const [localId, serverUuid] of camUuidMap.entries()) {
        if (!cameras.find(c => c.id === localId)) {
          await deleteCameraPlacement(serverUuid)
          camUuidMap.delete(localId)
        }
      }
      for (const cam of cameras) {
        if (!camUuidMap.has(cam.id)) {
          const created = await createCameraPlacement({
            label: cam.label, camera_index: cam.camIndex, wall: cam.wall,
            pos_u: cam.posU, pos_v: cam.posV, fov_degrees: cam.fovDeg,
          })
          camUuidMap.set(cam.id, created.uuid)
        }
      }

      // 3. Obstacles — same pattern
      for (const [localId, serverUuid] of obsUuidMap.entries()) {
        if (!obstacles.find(o => o.id === localId)) {
          await deleteObstacle(serverUuid)
          obsUuidMap.delete(localId)
        }
      }
      for (const obs of obstacles) {
        const payload = {
          label: obs.label, color: obs.color, passable: obs.passable,
          x_frac: obs.xF, y_frac: obs.yF, z_frac: obs.zF,
          w_frac: obs.wF, h_frac: obs.hF, d_frac: obs.dF,
        }
        if (obsUuidMap.has(obs.id)) {
          await updateObstacle(obsUuidMap.get(obs.id)!, payload)
        } else {
          const created = await createObstacle(payload)
          obsUuidMap.set(obs.id, created.uuid)
        }
      }

      setSaveStatus("ok")
    } catch {
      setSaveStatus("err")
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus("idle"), 2500)
    }
  }

  const gallons = cubicInchesToGallons(dims.widthCm, dims.heightCm, dims.depthCm)

  return (
    <div className="flex h-full bg-zinc-950 overflow-hidden">

      {/* ── Left sidebar ── */}
      <aside className={`shrink-0 flex flex-col border-r border-zinc-800/60 overflow-hidden transition-all duration-200 ${sidebarOpen ? "w-[256px]" : "w-10"}`}>

        {/* Collapse toggle */}
        <div className={`flex items-center border-b border-zinc-800/60 shrink-0 ${sidebarOpen ? "justify-end px-2 py-1.5" : "justify-center py-1.5"}`}>
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="text-zinc-600 hover:text-foreground transition-colors p-1 rounded"
          >
            {sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>

        {/* Scrollable content — hidden when collapsed */}
        {sidebarOpen && <div className="flex flex-col flex-1 overflow-y-auto">

        {/* Dimensions */}
        <section className="p-4 border-b border-zinc-800/60">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">Tank dimensions</p>
          <div className="flex flex-col gap-3">
            <DimInput label="Width"  value={dims.widthCm}  onChange={v => setDims(p => ({ ...p, widthCm: v }))} />
            <DimInput label="Height" value={dims.heightCm} onChange={v => setDims(p => ({ ...p, heightCm: v }))} />
            <DimInput label="Depth"  value={dims.depthCm}  onChange={v => setDims(p => ({ ...p, depthCm: v }))} />
          </div>
          <p className="text-xs font-mono text-zinc-600 mt-3">{gallons} gal estimated</p>
        </section>

        {/* Cameras */}
        <section className="p-4 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Cameras</p>
            <div className="flex items-center gap-2">
              {liveEntities.length > 0 && (
                <button
                  onClick={() => setShowLive(v => !v)}
                  className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                    showLive
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-700 text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full ${showLive ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  live
                </button>
              )}
              <button
                onClick={() => { setPlacingCamera(true); setPending(null) }}
                className="text-[9px] font-mono text-orange-400 hover:text-orange-300 transition-colors"
              >+ place</button>
            </div>
          </div>

          {placingCamera && (
            <p className="text-[9px] font-mono text-blue-400 mb-2 animate-pulse">
              Click a wall in the 3D view…
            </p>
          )}

          {pending && (
            <div className="flex flex-col gap-2 p-2.5 rounded bg-zinc-900 border border-zinc-700 mb-2">
              <p className="text-[9px] font-mono text-zinc-400">
                Wall: <span className="text-orange-400">{pending.wall}</span>
              </p>
              <input
                value={camLabel}
                onChange={e => setCamLabel(e.target.value)}
                placeholder="Camera label"
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
              />
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Select camera</p>
              <div className="flex gap-2">
                {[0, 1].map(idx => (
                  <button
                    key={idx}
                    onClick={() => setCamIndex(idx)}
                    className={`flex-1 flex flex-col rounded overflow-hidden border transition-all ${
                      camIndex === idx
                        ? "border-orange-500 ring-1 ring-orange-500/40"
                        : "border-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    <div className="relative bg-zinc-950" style={{ aspectRatio: "16/9" }}>
                      <img
                        src={streamUrl(idx)}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        alt=""
                      />
                      {camIndex === idx && (
                        <div className="absolute inset-0 ring-inset ring-2 ring-orange-500/60 pointer-events-none rounded" />
                      )}
                    </div>
                    <div className={`text-center text-[8px] font-mono py-0.5 transition-colors ${
                      camIndex === idx ? "bg-orange-500/20 text-orange-300" : "bg-zinc-900 text-zinc-500"
                    }`}>
                      CAM {idx + 1}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button onClick={confirmCamera}
                  className="flex-1 text-[9px] font-mono bg-orange-500 hover:bg-orange-400 text-white rounded py-1 transition-colors">
                  Confirm
                </button>
                <button onClick={() => setPending(null)}
                  className="flex-1 text-[9px] font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded py-1 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {cameras.length === 0
              ? <p className="text-[9px] font-mono text-zinc-700">No cameras placed</p>
              : cameras.map(c => (
                <div key={c.id}>
                  {editingCamId === c.id ? (
                    <div className="flex flex-col gap-2 p-2.5 rounded bg-zinc-900 border border-orange-500/40">
                      <input
                        autoFocus
                        value={c.label}
                        onChange={e => setCameras(p => p.map(x => x.id === c.id ? { ...x, label: e.target.value } : x))}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                      <div className="flex gap-2">
                        {[0, 1].map(idx => (
                          <button key={idx} onClick={() => setCameras(p => p.map(x => x.id === c.id ? { ...x, camIndex: idx } : x))}
                            className={`flex-1 flex flex-col rounded overflow-hidden border transition-all ${c.camIndex === idx ? "border-orange-500" : "border-zinc-700 hover:border-zinc-500"}`}>
                            <img src={streamUrl(idx)} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} alt="" />
                            <div className={`text-center text-[8px] font-mono py-0.5 ${c.camIndex === idx ? "bg-orange-500/20 text-orange-300" : "bg-zinc-900 text-zinc-500"}`}>
                              CAM {idx + 1}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between px-2 py-1 rounded bg-zinc-800/60 text-[9px] font-mono text-zinc-500">
                        <span>wall: <span className="text-orange-400">{c.wall}</span> · u:{c.posU.toFixed(2)} v:{c.posV.toFixed(2)}</span>
                        <button
                          onClick={() => { setReplacingCamId(c.id); setPlacingCamera(true) }}
                          className="text-blue-400 hover:text-blue-300 transition-colors ml-2"
                        >re-place →</button>
                      </div>
                      <button onClick={() => setEditingCamId(null)}
                        className="text-[9px] font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded py-1 transition-colors">
                        done
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-900 group cursor-pointer hover:bg-zinc-800/60 transition-colors"
                      onClick={() => setEditingCamId(c.id)}>
                      <div className="shrink-0 w-10 rounded overflow-hidden border border-zinc-700" style={{ aspectRatio: "16/9" }}>
                        <img src={streamUrl(c.camIndex)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-mono text-orange-300 truncate">{c.label}</p>
                        <p className="text-[8px] font-mono text-zinc-600">{c.wall} · CAM {c.camIndex + 1}</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setCameras(p => p.filter(x => x.id !== c.id)) }}
                        className="text-[9px] text-zinc-700 hover:text-red-400 leading-none opacity-0 group-hover:opacity-100 transition-opacity shrink-0">×</button>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
        </section>

        {/* Obstacles */}
        <section className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Obstacles</p>
            <button onClick={() => setShowObsForm(v => !v)}
              className="text-[9px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors">
              + add
            </button>
          </div>

          {showObsForm && (
            <div className="flex flex-col gap-2 p-2.5 rounded bg-zinc-900 border border-zinc-700 mb-2">
              <input
                value={newObs.label}
                onChange={e => setNewObs(p => ({ ...p, label: e.target.value }))}
                placeholder="e.g. Driftwood, Rock"
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-100 focus:outline-none"
              />
              <p className="text-[8px] font-mono text-zinc-600">Position (0–1)</p>
              <div className="grid grid-cols-3 gap-1">
                {(["xF", "yF", "zF"] as const).map(k => (
                  <input key={k} type="number" step={0.05} min={0} max={1}
                    value={newObs[k]}
                    onChange={e => setNewObs(p => ({ ...p, [k]: Number(e.target.value) }))}
                    placeholder={k === "xF" ? "X" : k === "yF" ? "Y" : "Z"}
                    className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] font-mono text-zinc-100 focus:outline-none"
                  />
                ))}
              </div>
              <p className="text-[8px] font-mono text-zinc-600">Size (fraction of tank)</p>
              <div className="grid grid-cols-3 gap-1">
                {(["wF", "hF", "dF"] as const).map(k => (
                  <input key={k} type="number" step={0.05} min={0.01} max={1}
                    value={newObs[k]}
                    onChange={e => setNewObs(p => ({ ...p, [k]: Number(e.target.value) }))}
                    placeholder={k === "wF" ? "W" : k === "hF" ? "H" : "D"}
                    className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] font-mono text-zinc-100 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex gap-1 flex-wrap">
                {OBS_COLORS.map(c => (
                  <button key={c} onClick={() => setNewObs(p => ({ ...p, color: c }))}
                    style={{ background: c }}
                    className={`w-5 h-5 rounded border-2 transition-all ${newObs.color === c ? "border-white" : "border-transparent"}`}
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <button onClick={addObstacle}
                  className="flex-1 text-[9px] font-mono bg-zinc-600 hover:bg-zinc-500 text-white rounded py-1 transition-colors">
                  Add
                </button>
                <button onClick={() => setShowObsForm(false)}
                  className="flex-1 text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded py-1 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {obstacles.length === 0
              ? <p className="text-[9px] font-mono text-zinc-700">No obstacles added</p>
              : obstacles.map(o => (
                <div key={o.id} className="flex items-center justify-between px-2 py-1 rounded bg-zinc-900">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: o.color }} />
                    <span className="text-[9px] font-mono text-zinc-300 truncate">{o.label}</span>
                  </div>
                  <button onClick={() => setObstacles(p => p.filter(x => x.id !== o.id))}
                    className="text-[9px] text-zinc-600 hover:text-red-400 shrink-0 leading-none">×</button>
                </div>
              ))
            }
          </div>
        </section>

        {/* Save */}
        <div className="p-4 mt-auto border-t border-zinc-800/60">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 rounded text-[10px] font-mono uppercase tracking-widest transition-colors disabled:opacity-50
              bg-orange-500 hover:bg-orange-400 text-white"
          >
            {saving ? "Saving…" : saveStatus === "ok" ? "Saved ✓" : saveStatus === "err" ? "Error ✗" : "Save layout"}
          </button>
        </div>
        </div>}
      </aside>

      {/* ── 3D canvas ── */}
      <div className="flex-1 relative min-w-0">
        {placingCamera && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded bg-zinc-900/90 border border-blue-800/60">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[9px] font-mono text-blue-300 uppercase tracking-widest">
              {replacingCamId ? "Click a wall to move camera" : "Click a wall to place"}
            </span>
            <button onClick={() => { setPlacingCamera(false); setReplacingCamId(null) }}
              className="text-[9px] font-mono text-zinc-500 hover:text-white transition-colors">
              cancel
            </button>
          </div>
        )}

        <Canvas
          camera={{
            position: [toCm(dims.widthCm) * 1.3, toCm(dims.heightCm) * 1.6, toCm(dims.depthCm) * 2.4],
            fov: 45,
            near: 0.1,
            far: 10000,
          }}
          style={{ background: "#09090b" }}
        >
          <Suspense fallback={null}>
            <Scene
              dims={{ widthCm: toCm(dims.widthCm), heightCm: toCm(dims.heightCm), depthCm: toCm(dims.depthCm) }}
              cameras={cameras}
              obstacles={obstacles}
              placingCamera={placingCamera}
              onWallPlace={handleWallPlace}
              showLive={showLive}
              liveEntities={liveEntities}
              frameWidth={frameWidth}
              frameHeight={frameHeight}
            />
          </Suspense>
        </Canvas>
      </div>
    </div>
  )
}
