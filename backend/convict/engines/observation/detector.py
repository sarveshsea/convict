"""
Fish detector.

BackgroundSubtractorDetector — MOG2 background subtraction. Works by
                 learning the static tank background (substrate, driftwood,
                 plants) over the first ~60 frames, then isolates anything
                 moving. Ideal for fish tanks with a static background.
                 No model download required.

FishDetector   — YOLOv8n inference fallback (COCO has no fish class;
                 kept for future fine-tuning).

RFDETRDetector — RF-DETR (Roboflow, 2026) transformer-based detector.
                 Higher accuracy than YOLOv8n (48.4 vs ~37 mAP) at
                 similar latency. No NMS — cleaner detections.
                 Requires: pip install rfdetr

MockDetector   — returns pre-computed bboxes from MockCameraCapture.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import cv2
import numpy as np

if TYPE_CHECKING:
    from convict.engines.observation.camera import MockCameraCapture


class BackgroundSubtractorDetector:
    """
    MOG2 background subtraction — learns the static tank background then
    detects moving blobs (fish) each frame.  No model weights needed.

    Tune via settings:
      bg_var_threshold   — MOG2 sensitivity (higher = ignore smaller motion)
      bg_min_area        — minimum blob area in pixels² (original frame coords)
      bg_warmup_frames   — frames to learn background before emitting detections
    """

    def __init__(self, settings):
        self._s       = settings
        self._sub     = cv2.createBackgroundSubtractorMOG2(
            history       = 500,
            varThreshold  = getattr(settings, "bg_var_threshold", 80),
            detectShadows = False,
        )
        # Larger kernels → merges fragmented detections, kills tiny ripple blobs
        self._open_k  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7,  7))
        self._close_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        self._frame_n = 0
        self._warmup   = getattr(settings, "bg_warmup_frames", 150)
        self._min_area = getattr(settings, "bg_min_area",      2000)
        self._max_area = getattr(settings, "bg_max_area",   120_000)

    def load(self) -> None:
        pass

    def set_var_threshold(self, value: int) -> None:
        """Adjust MOG2 sensitivity at runtime (e.g. switching to night mode)."""
        self._sub.setVarThreshold(float(value))

    # ------------------------------------------------------------------

    @staticmethod
    def _nms(boxes: np.ndarray, confs: np.ndarray,
             iou_thresh: float = 0.35) -> tuple[np.ndarray, np.ndarray]:
        """Non-maximum suppression — removes duplicate boxes for the same fish."""
        if len(boxes) == 0:
            return boxes, confs
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas  = (x2 - x1) * (y2 - y1)
        order  = confs.argsort()[::-1]
        keep   = []
        while order.size:
            i = order[0]
            keep.append(i)
            ix1 = np.maximum(x1[i], x1[order[1:]])
            iy1 = np.maximum(y1[i], y1[order[1:]])
            ix2 = np.minimum(x2[i], x2[order[1:]])
            iy2 = np.minimum(y2[i], y2[order[1:]])
            inter = np.maximum(0, ix2 - ix1) * np.maximum(0, iy2 - iy1)
            iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
            order = order[np.where(iou <= iou_thresh)[0] + 1]
        idx = np.array(keep)
        return boxes[idx], confs[idx]

    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray):
        import supervision as sv

        self._frame_n += 1

        h, w  = frame.shape[:2]
        iw    = self._s.inference_width
        scale = iw / w
        small = cv2.resize(frame, (iw, int(h * scale)))

        fg = self._sub.apply(small)

        # Remove noise: open kills small specks, close fills gaps within fish blob
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN,  self._open_k)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, self._close_k)

        # Still warming up the background model
        if self._frame_n < self._warmup:
            return sv.Detections.empty()

        cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        boxes: list[list[float]] = []
        confs: list[float]       = []

        for c in cnts:
            area      = cv2.contourArea(c)
            orig_area = area / (scale * scale)          # scale back to original px²
            if not (self._min_area <= orig_area <= self._max_area):
                continue

            x, y, bw, bh = cv2.boundingRect(c)
            aspect = bw / max(bh, 1)
            # Fish are roughly 0.3–7× wider than tall; very thin/vertical = driftwood
            if aspect < 0.3 or aspect > 7.0:
                continue

            # Scale bbox to original frame coords with small pad
            pad = 8
            x1 = max(0, int(x / scale) - pad)
            y1 = max(0, int(y / scale) - pad)
            x2 = min(w, int((x + bw) / scale) + pad)
            y2 = min(h, int((y + bh) / scale) + pad)

            conf = float(min(0.95, 0.55 + orig_area / self._max_area * 0.4))
            boxes.append([x1, y1, x2, y2])
            confs.append(conf)

        if not boxes:
            return sv.Detections.empty()

        b = np.array(boxes, dtype=np.float32)
        c = np.array(confs, dtype=np.float32)
        b, c = self._nms(b, c, iou_thresh=0.35)

        return sv.Detections(
            xyxy       = b,
            confidence = c,
            class_id   = np.zeros(len(b), dtype=int),
        )


class FishDetector:
    """
    Wraps YOLOv8n.  Call `load()` once before the pipeline loop
    (downloads the model on first run, ~6MB).
    """

    # Heuristic filter bounds (pixels in *original* frame, not inference size)
    MIN_AREA    = 400      # ignore tiny noise
    MAX_AREA    = 70_000   # ignore near-full-frame detections
    MIN_ASPECT  = 0.25     # min w/h — fish are wider than tall
    MAX_ASPECT  = 6.0      # max w/h

    def __init__(self, settings):
        self._settings = settings
        self._model = None

    def load(self) -> None:
        from ultralytics import YOLO
        model_path = self._settings.yolo_model_path
        if model_path.exists():
            self._model = YOLO(str(model_path))
        else:
            # Auto-download yolov8n.pt and cache it for next run
            self._model = YOLO("yolov8n.pt")
            model_path.parent.mkdir(parents=True, exist_ok=True)
            self._model.save(str(model_path))

    def detect(self, frame: np.ndarray):
        """Synchronous — safe to call via asyncio.to_thread."""
        import supervision as sv

        if self._model is None:
            return sv.Detections.empty()

        results = self._model.predict(
            frame,
            imgsz=self._settings.inference_width,
            conf=self._settings.yolo_confidence,
            iou=self._settings.yolo_iou,
            verbose=False,
        )[0]

        if len(results.boxes) == 0:
            return sv.Detections.empty()

        boxes = results.boxes.xyxy.cpu().numpy().astype(np.float32)   # (N,4)
        confs = results.boxes.conf.cpu().numpy().astype(np.float32)   # (N,)

        keep: list[int] = []
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            bw     = x2 - x1
            bh     = y2 - y1
            area   = bw * bh
            aspect = bw / max(bh, 1.0)
            if (self.MIN_AREA <= area <= self.MAX_AREA and
                    self.MIN_ASPECT <= aspect <= self.MAX_ASPECT):
                keep.append(i)

        if not keep:
            return sv.Detections.empty()

        idx = np.array(keep)
        return sv.Detections(
            xyxy=boxes[idx],
            confidence=confs[idx],
            class_id=np.zeros(len(idx), dtype=int),
        )


class RFDETRDetector:
    """
    RF-DETR (Roboflow, 2026) — transformer-based detector, no NMS needed.
    Significantly better accuracy than YOLOv8n at similar latency.

    Requires: pip install rfdetr
    Weights auto-downloaded on first run (~120MB).

    Call `load()` once before the pipeline loop.
    """

    MIN_AREA   = 400
    MAX_AREA   = 70_000
    MIN_ASPECT = 0.25
    MAX_ASPECT = 6.0

    def __init__(self, settings):
        self._settings = settings
        self._model = None

    def load(self) -> None:
        if self._settings.rfdetr_model_size == "large":
            from rfdetr import RFDETRLarge
            self._model = RFDETRLarge()
        else:
            from rfdetr import RFDETRBase
            self._model = RFDETRBase()

    def detect(self, frame: np.ndarray):
        import supervision as sv
        from PIL import Image

        if self._model is None:
            return sv.Detections.empty()

        pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        detections = self._model.predict(
            pil_img,
            threshold=self._settings.rfdetr_confidence_threshold,
        )

        if len(detections) == 0:
            return sv.Detections.empty()

        boxes = detections.xyxy
        confs = (detections.confidence
                 if detections.confidence is not None
                 else np.full(len(boxes), 0.85, dtype=np.float32))

        keep: list[int] = []
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            bw     = x2 - x1
            bh     = y2 - y1
            area   = bw * bh
            aspect = bw / max(bh, 1.0)
            if (self.MIN_AREA <= area <= self.MAX_AREA and
                    self.MIN_ASPECT <= aspect <= self.MAX_ASPECT):
                keep.append(i)

        if not keep:
            return sv.Detections.empty()

        idx = np.array(keep)
        return sv.Detections(
            xyxy=boxes[idx].astype(np.float32),
            confidence=confs[idx].astype(np.float32),
            class_id=np.zeros(len(idx), dtype=int),
        )


class MockDetector:
    """
    Returns detections from the MockCameraCapture's pre-computed
    fish positions — no inference needed.
    """

    def __init__(self, camera: "MockCameraCapture"):
        self._camera = camera

    def load(self) -> None:
        pass  # nothing to load

    def detect(self, frame: np.ndarray):
        import supervision as sv

        positions = self._camera.get_detections()
        if not positions:
            return sv.Detections.empty()

        boxes = np.array(
            [[x1, y1, x2, y2] for x1, y1, x2, y2 in positions],
            dtype=np.float32,
        )
        confs = np.full(len(positions), 0.92, dtype=np.float32)
        return sv.Detections(
            xyxy=boxes,
            confidence=confs,
            class_id=np.zeros(len(positions), dtype=int),
        )
