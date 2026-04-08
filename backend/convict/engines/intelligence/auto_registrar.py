"""
AutoRegistrar — watches stable tracks and auto-creates KnownFish records.

When a track has been continuously visible for `auto_register_min_stable_frames`
frames WITHOUT an assigned identity, this engine:
  1. Builds an averaged color histogram from the last N bboxes.
  2. Checks for duplicates against existing auto-detected fish (dedup).
     - If near-duplicate found → hint the resolver to re-associate the track
       to the existing fish (handles track loss + reacquisition).
     - Otherwise → create a new KnownFish with an auto-generated name.
  3. Returns True so the orchestrator can hot-reload the identity resolver.

Nothing is required from the user — fish appear in the roster automatically.
"""
from __future__ import annotations

import uuid as _uuid
from collections import defaultdict, deque
from typing import TYPE_CHECKING

import cv2
import numpy as np

if TYPE_CHECKING:
    from convict.engines.intelligence.identity_resolver import IdentityResolver

_SIZE_THRESHOLDS_CM = {"small": 9.0, "medium": 18.0}   # ≤9 small, ≤18 medium, else large


def _px_to_cm(px_len: float, frame_width: int, tank_width_cm: float) -> float:
    return px_len * (tank_width_cm / max(frame_width, 1))


def _size_class(est_cm: float) -> str:
    if est_cm <= _SIZE_THRESHOLDS_CM["small"]:
        return "small"
    if est_cm <= _SIZE_THRESHOLDS_CM["medium"]:
        return "medium"
    return "large"


class AutoRegistrar:
    def __init__(self, settings, tank_id: int, tank_width_cm: float = 60.0):
        self._s             = settings
        self._tank_id       = tank_id
        self._tank_width_cm = max(tank_width_cm, 1.0)

        # consecutive visible-frame count per track_id
        self._stable_count: dict[int, int] = defaultdict(int)
        # last N bboxes per track (for histogram averaging)
        self._bbox_history: dict[int, deque] = {}
        # fish UUIDs created this session (to avoid double-create on same session)
        self._registered_uuids: set[str] = set()
        # auto-name counter seeded from DB at init
        self._name_counter: int = 0

    # ------------------------------------------------------------------

    async def initialize(self, db) -> None:
        """Seed name counter from existing auto_detected fish in DB."""
        from sqlalchemy import select, func
        from convict.models.known_fish import KnownFish

        result = await db.execute(
            select(func.count()).select_from(KnownFish).where(
                KnownFish.tank_id == self._tank_id,
                KnownFish.auto_detected == True,   # noqa: E712
            )
        )
        self._name_counter = result.scalar_one() or 0

    # ------------------------------------------------------------------

    async def process(
        self,
        entities: list[dict],
        frame: np.ndarray,
        resolver: "IdentityResolver",
        db,
    ) -> bool:
        """
        Call once per frame after entities are built.
        Returns True if a new fish was registered (orchestrator should reload).
        """
        active_tids = {e["track_id"] for e in entities}

        # Decay absent tracks
        for tid in list(self._stable_count):
            if tid not in active_tids:
                self._stable_count[tid] = 0

        threshold = self._s.auto_register_min_stable_frames
        registered_any = False

        for e in entities:
            tid = e["track_id"]
            self._stable_count[tid] += 1

            # Maintain bbox history
            if tid not in self._bbox_history:
                self._bbox_history[tid] = deque(maxlen=self._s.auto_register_hist_sample_frames)
            self._bbox_history[tid].append(e["bbox"])

            # Only fire exactly at threshold (not every frame after)
            if self._stable_count[tid] != threshold:
                continue

            # Already identified — skip
            if e["identity"].get("fish_id"):
                continue

            created = await self._try_register(e, frame, resolver, db)
            if created:
                registered_any = True
                # Reset so we don't re-fire every frame for the same track
                self._stable_count[tid] = 0

        return registered_any

    # ------------------------------------------------------------------

    async def _try_register(
        self,
        entity: dict,
        frame: np.ndarray,
        resolver: "IdentityResolver",
        db,
    ) -> bool:
        tid   = entity["track_id"]
        bboxes = list(self._bbox_history.get(tid, []))
        if not bboxes:
            return False

        # ── Plausibility gate: reject non-fish blobs ──────────────────────────
        # People, hands, and other intruders have aspect ratios and relative
        # sizes that no fish species produces. Reject before any DB work.
        fh, fw = frame.shape[:2]
        x1, y1, x2, y2 = entity["bbox"]
        bw = max(x2 - x1, 1)
        bh = max(y2 - y1, 1)
        aspect   = bh / bw                          # h/w: person ≈ 3-6, fish ≈ 0.3-2.5
        rel_area = (bw * bh) / max(fw * fh, 1)      # fraction of total frame

        max_aspect = getattr(self._s, "auto_register_max_aspect_ratio", 3.0)
        max_area   = getattr(self._s, "auto_register_max_bbox_area_ratio", 0.12)

        if aspect > max_aspect:
            return False   # tall/narrow → standing person or other non-fish
        if rel_area > max_area:
            return False   # too large → person close to camera

        # Build averaged histogram
        candidate_hist = self._avg_histogram(frame, bboxes, resolver)
        if candidate_hist is None:
            return False

        # Estimate size
        x1, y1, x2, y2 = entity["bbox"]
        px_len  = max(x2 - x1, y2 - y1)
        est_cm  = _px_to_cm(px_len, fw, self._tank_width_cm)
        s_class = _size_class(est_cm)

        # Dedup: check existing auto-detected fish for near-duplicate
        existing = await self._find_duplicate(candidate_hist, s_class, db)
        if existing is not None:
            # Reacquired track — reassociate with existing fish
            resolver.hint_track_identity(tid, existing.uuid)
            return False

        # Create new KnownFish
        self._name_counter += 1
        fish_name = f"Fish {self._name_counter}"

        from convict.models.known_fish import KnownFish
        fish = KnownFish(
            uuid=str(_uuid.uuid4()),
            tank_id=self._tank_id,
            name=fish_name,
            species="Unknown",
            size_class=s_class,
            estimated_length_cm=round(est_cm, 1),
            temperament="peaceful",
            color_histogram=candidate_hist.tobytes(),
            auto_detected=True,
            species_guess_confidence=0.0,
            is_active=True,
        )
        db.add(fish)
        await db.commit()
        await db.refresh(fish)
        self._registered_uuids.add(fish.uuid)

        # Save snapshot crop for the left panel thumbnail
        self._save_snapshot(fish.uuid, frame, entity["bbox"])

        return True

    # ------------------------------------------------------------------

    def _save_snapshot(self, fish_uuid: str, frame: np.ndarray, bbox: list) -> None:
        try:
            fh, fw = frame.shape[:2]
            x1, y1, x2, y2 = [int(v) for v in bbox]
            pad = 12
            x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
            x2, y2 = min(fw, x2 + pad), min(fh, y2 + pad)
            crop = frame[y1:y2, x1:x2]
            if crop.size == 0:
                return
            # Must match API path: settings.db_path.parent / "snapshots" (not CWD-relative).
            snapshots_dir = self._s.db_path.parent / "snapshots"
            snapshots_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(snapshots_dir / f"{fish_uuid}.jpg"), crop, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        except Exception:
            pass

    def _avg_histogram(
        self,
        frame: np.ndarray,
        bboxes: list,
        resolver: "IdentityResolver",
    ) -> np.ndarray | None:
        hists: list[np.ndarray] = []
        for bbox in bboxes:
            raw = resolver.extract_histogram(frame, bbox)
            if raw is not None:
                arr = np.frombuffer(raw, dtype=np.float32)
                if arr.size == 288:  # 18 hue × 16 sat bins
                    hists.append(arr)
        if not hists:
            return None
        return np.mean(hists, axis=0).astype(np.float32)

    async def _find_duplicate(
        self,
        candidate_hist: np.ndarray,
        size_class: str,
        db,
    ):
        """Return an existing auto-detected fish if color+size matches candidate."""
        from sqlalchemy import select
        from convict.models.known_fish import KnownFish

        rows = (await db.execute(
            select(KnownFish).where(
                KnownFish.tank_id == self._tank_id,
                KnownFish.auto_detected == True,   # noqa: E712
                KnownFish.is_active == True,
                KnownFish.size_class == size_class,
                KnownFish.color_histogram != None,  # noqa: E711
            )
        )).scalars().all()

        threshold = self._s.auto_register_color_dedup_threshold
        for fish in rows:
            stored = np.frombuffer(fish.color_histogram, dtype=np.float32)
            if stored.shape != candidate_hist.shape:
                continue
            dist = float(np.sum(np.abs(candidate_hist - stored)) / 2.0)
            if dist < threshold:
                return fish
        return None
