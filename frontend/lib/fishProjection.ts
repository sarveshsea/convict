/**
 * fishProjection.ts — pure math, no React/Three.js deps
 *
 * Projects a 2D fish centroid (pixel space) through a configured camera's
 * FOV geometry into 3D tank space (centimeters, origin at tank center).
 *
 * Since a single camera produces a ray (not a point), we intersect with
 * the mid-plane — the plane through the tank center perpendicular to the
 * camera's optical axis. This gives accurate lateral + vertical position
 * with depth fixed at the tank's center.
 */

import type { CamPlacement, TankDims } from "@/components/tank/TankConfigurator3D"

type Vec3 = [number, number, number]

interface CamBasis {
  pos:     Vec3   // camera world position (cm, tank-centered)
  forward: Vec3   // unit vector pointing into the tank
  right:   Vec3   // unit vector pointing camera-right across the image
  up:      Vec3   // unit vector pointing camera-up in the image
}

/**
 * Returns the world-space basis for a placed camera.
 *
 * "forward" is the direction the physical camera lens faces INTO the tank.
 * "right" is the direction that increasing pixel-X maps to in world space.
 * "up"    is the direction that increasing pixel-Y (flipped to 3D-up) maps to.
 *
 * The 4% wall offset from wallPosition() is intentionally kept so that the
 * camera origin matches the rendered icon exactly.
 */
function getCamBasis(cam: CamPlacement, w: number, h: number, d: number): CamBasis {
  const off = Math.min(w, h, d) * 0.04
  const u = cam.posU
  const v = cam.posV

  switch (cam.wall) {
    case "front":
      return {
        pos:     [(u - 0.5) * w, (v - 0.5) * h,  d / 2 + off],
        forward: [0,  0, -1],
        right:   [1,  0,  0],
        up:      [0,  1,  0],
      }
    case "back":
      return {
        pos:     [(u - 0.5) * w, (v - 0.5) * h, -d / 2 - off],
        forward: [0,  0,  1],
        right:   [-1, 0,  0],  // image X flipped vs front (mirror)
        up:      [0,  1,  0],
      }
    case "left":
      return {
        pos:     [-w / 2 - off, (v - 0.5) * h, (u - 0.5) * d],
        forward: [1,  0,  0],
        right:   [0,  0, -1],
        up:      [0,  1,  0],
      }
    case "right":
      return {
        pos:     [ w / 2 + off, (v - 0.5) * h, (u - 0.5) * d],
        forward: [-1, 0,  0],
        right:   [0,  0,  1],
        up:      [0,  1,  0],
      }
    case "top":
      return {
        pos:     [(u - 0.5) * w, h / 2 + off, (v - 0.5) * d],
        forward: [0, -1,  0],
        right:   [1,  0,  0],
        up:      [0,  0, -1],  // image-up = world -Z (toward back wall)
      }
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * Projects a 2D pixel centroid through the camera's FOV into 3D tank space.
 *
 * @param centroid  [cx, cy] in absolute pixels
 * @param frameW    Frame width in pixels
 * @param frameH    Frame height in pixels
 * @param cam       Camera placement (wall, posU, posV, fovDeg)
 * @param dims      Tank dimensions in cm
 * @returns         [x, y, z] in cm (tank-centered) or null if degenerate
 */
export function projectFishTo3D(
  centroid: [number, number],
  frameW: number,
  frameH: number,
  cam: CamPlacement,
  dims: TankDims,
): [number, number, number] | null {
  if (!frameW || !frameH) return null

  const { widthCm: w, heightCm: h, depthCm: d } = dims
  const { pos, forward, right, up } = getCamBasis(cam, w, h, d)

  // Pixel → NDC [-1, 1]; flip Y because pixel Y grows down, 3D Y grows up
  const nx = (centroid[0] / frameW) * 2 - 1
  const ny = -((centroid[1] / frameH) * 2 - 1)

  // fovDeg is treated as horizontal FOV
  const tanHalfH = Math.tan((cam.fovDeg / 2) * (Math.PI / 180))
  const tanHalfV = tanHalfH / (frameW / frameH)

  // World-space ray direction (not yet normalized)
  const rawRay: Vec3 = [
    forward[0] + nx * tanHalfH * right[0] + ny * tanHalfV * up[0],
    forward[1] + nx * tanHalfH * right[1] + ny * tanHalfV * up[1],
    forward[2] + nx * tanHalfH * right[2] + ny * tanHalfV * up[2],
  ]
  const rayDir = normalize(rawRay)

  // Intersect ray with the mid-plane: forward · P = 0
  // Plane passes through origin, perpendicular to optical axis.
  // t = -(forward · camPos) / (forward · rayDir)
  const fDotRay = dot(forward, rayDir)
  if (Math.abs(fDotRay) < 1e-9) return null  // ray nearly parallel to mid-plane

  const t = -dot(forward, pos) / fDotRay
  if (t < 0) return null  // intersection behind camera

  const px = pos[0] + t * rayDir[0]
  const py = pos[1] + t * rayDir[1]
  const pz = pos[2] + t * rayDir[2]

  // Clamp to tank bounds (±half-dims)
  return [
    Math.max(-w / 2, Math.min(w / 2, px)),
    Math.max(-h / 2, Math.min(h / 2, py)),
    Math.max(-d / 2, Math.min(d / 2, pz)),
  ]
}
