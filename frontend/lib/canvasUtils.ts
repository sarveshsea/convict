import { CANVAS_COLORS } from "./constants"

/** Set up a HiDPI canvas. Returns the pixel ratio used. */
export function setupHiDPI(canvas: HTMLCanvasElement): number {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext("2d")!
  ctx.scale(dpr, dpr)
  return dpr
}

/** Fill canvas background. */
export function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = CANVAS_COLORS.bg
  ctx.fillRect(0, 0, w, h)
}

/** Draw horizontal grid lines with Y-axis labels. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  padL: number, padR: number, padT: number, padB: number,
  w: number, h: number,
  steps: number,
  labelFn?: (i: number) => string,
) {
  const cW = w - padL - padR
  const cH = h - padT - padB
  ctx.strokeStyle = CANVAS_COLORS.grid
  ctx.lineWidth   = 0.5
  ctx.fillStyle   = CANVAS_COLORS.text
  ctx.font        = `7px 'Fira Code', monospace`
  ctx.textAlign   = "right"

  for (let i = 0; i <= steps; i++) {
    const y = padT + cH * (1 - i / steps)
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + cW, y)
    ctx.stroke()
    if (labelFn) {
      ctx.fillText(labelFn(i), padL - 3, y + 3)
    }
  }
}

/** Draw a text label at (x, y). */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "center",
) {
  ctx.fillStyle  = CANVAS_COLORS.text
  ctx.font       = `8px 'Fira Code', monospace`
  ctx.textAlign  = align
  ctx.fillText(text, x, y)
}

/** Draw a dashed horizontal reference line. */
export function drawMeanLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x1: number,
  x2: number,
) {
  ctx.save()
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = CANVAS_COLORS.muted
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.restore()
}
