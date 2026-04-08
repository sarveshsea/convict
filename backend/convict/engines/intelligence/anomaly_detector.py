"""
Anomaly detector.

Runs two tiers:
  Every frame   — track missing-fish counters, pairwise proximity counters
  Every 60 frames (~12s) — evaluate thresholds and emit events

Detected event types:
  missing_fish   — known fish unseen for missing_fish_frames
  harassment     — two identified fish within harassment_distance_px
                   for harassment_duration_frames consecutive frames
  lethargy       — identified fish speed > 3σ below baseline mean
  hyperactivity  — identified fish speed > 3σ above baseline mean

Interaction edges (drained by orchestrator via pop_interactions()):
  harassment  — emitted when harassment threshold fires
  proximity   — emitted when a close pair separates after >=15 frames together
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from convict.engines.intelligence.baseline_builder import BaselineBuilder

# Minimum close frames before a separating pair gets a "proximity" edge recorded
_MIN_PROXIMITY_FRAMES = 15


class AnomalyDetector:
    def __init__(self, settings, known_fish: list, baseline: BaselineBuilder):
        self._s        = settings
        self._fish     = known_fish
        self._baseline = baseline
        self._frame    = 0

        # fish_uuid -> consecutive frames not seen
        self._unseen: dict[str, int] = defaultdict(int)
        # (track_id_a, track_id_b) -> consecutive close frames
        self._close:  dict[tuple, int] = defaultdict(int)
        # (track_id_a, track_id_b) -> (fish_uuid_a, fish_uuid_b) for pending edges
        self._close_ids: dict[tuple, tuple[str, str]] = {}
        # fish_uuid -> frames since last lethargy/hyper alert (cool-down)
        self._alerted: dict[str, int] = defaultdict(int)
        # Pending interaction edges -- drained by orchestrator via pop_interactions()
        self._pending_interactions: list[dict] = []

    # ------------------------------------------------------------------

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def update(self, entities: list[dict]) -> list[dict]:
        """
        Call every frame. Returns list of new anomaly event dicts
        (empty the vast majority of the time).
        """
        self._frame += 1
        events: list[dict] = []

        # --- Track which known fish are currently visible ---------------
        visible_ids = {
            e["identity"]["fish_id"]
            for e in entities
            if e["identity"].get("fish_id") and e["identity"].get("confidence", 0) >= 0.5
        }

        for fish in self._fish:
            if fish.uuid in visible_ids:
                self._unseen[fish.uuid] = 0
            else:
                self._unseen[fish.uuid] += 1

            # Missing fish -- fires exactly once per event
            if self._unseen[fish.uuid] == self._s.missing_fish_frames:
                events.append(self._make("missing_fish", "high",
                                         [{"fish_id": fish.uuid, "fish_name": fish.name}]))

        # Increment cool-down counters for alerted fish
        for fid in list(self._alerted):
            self._alerted[fid] += 1
            if self._alerted[fid] > 300:   # 5min cool-down
                del self._alerted[fid]

        # Only run expensive checks on the check interval
        if self._frame % self._s.anomaly_check_interval_frames != 0:
            return events

        # --- Harassment + proximity check ------------------------------
        ident = [e for e in entities if e["identity"].get("fish_id")]
        active_keys: set[tuple] = set()

        for i in range(len(ident)):
            for j in range(i + 1, len(ident)):
                ea, eb = ident[i], ident[j]
                cx_a, cy_a = ea["centroid"]
                cx_b, cy_b = eb["centroid"]
                dist = ((cx_a - cx_b) ** 2 + (cy_a - cy_b) ** 2) ** 0.5

                key = tuple(sorted([ea["track_id"], eb["track_id"]]))
                active_keys.add(key)

                fid_a = ea["identity"]["fish_id"]
                fid_b = eb["identity"]["fish_id"]

                if dist < self._s.harassment_distance_px:
                    self._close[key] += self._s.anomaly_check_interval_frames
                    self._close_ids[key] = (fid_a, fid_b)

                    if self._close[key] == self._s.harassment_duration_frames:
                        events.append(self._make(
                            "harassment", "high",
                            [
                                {"fish_id": fid_a, "fish_name": ea["identity"]["fish_name"]},
                                {"fish_id": fid_b, "fish_name": eb["identity"]["fish_name"]},
                            ],
                        ))
                        # Record harassment interaction edge
                        dur = (self._s.harassment_duration_frames
                               * self._s.detection_interval_ms / 1000.0)
                        self._pending_interactions.append({
                            "fish_a": fid_a,
                            "fish_b": fid_b,
                            "initiator": _initiator(ea, eb),
                            "interaction_type": "harassment",
                            "duration_seconds": dur,
                        })
                        self._close[key] = 0  # reset so event fires again after another full window
                else:
                    prev = self._close.get(key, 0)
                    if prev >= _MIN_PROXIMITY_FRAMES:
                        # Fish separated after meaningful proximity -- record edge
                        ids = self._close_ids.get(key, (fid_a, fid_b))
                        dur = prev * self._s.detection_interval_ms / 1000.0
                        self._pending_interactions.append({
                            "fish_a": ids[0],
                            "fish_b": ids[1],
                            "initiator": None,
                            "interaction_type": "proximity",
                            "duration_seconds": dur,
                        })
                    self._close[key] = max(0, self._close[key] - 3)

        # Clean up stale track pairs (tracks ended / fish left frame)
        stale = set(self._close.keys()) - active_keys
        for k in stale:
            prev = self._close.pop(k, 0)
            if prev >= _MIN_PROXIMITY_FRAMES:
                ids = self._close_ids.get(k)
                if ids:
                    dur = prev * self._s.detection_interval_ms / 1000.0
                    self._pending_interactions.append({
                        "fish_a": ids[0],
                        "fish_b": ids[1],
                        "initiator": None,
                        "interaction_type": "proximity",
                        "duration_seconds": dur,
                    })
            self._close_ids.pop(k, None)

        # --- Speed deviation check ------------------------------------
        for e in ident:
            fid  = e["identity"]["fish_id"]
            conf = e["identity"].get("confidence", 0.0)
            if conf < 0.6 or fid in self._alerted:
                continue

            mean, std = self._baseline.speed_stats(fid)
            if std < 0.5:
                continue  # not enough baseline data

            speed = e.get("speed_px_per_frame", 0.0)
            sigma = self._s.anomaly_speed_sigma

            fish_name = e["identity"]["fish_name"]
            if speed < mean - sigma * std:
                events.append(self._make("lethargy", "medium",
                                          [{"fish_id": fid, "fish_name": fish_name}]))
                self._alerted[fid] = 0
            elif speed > mean + sigma * std:
                events.append(self._make("hyperactivity", "medium",
                                          [{"fish_id": fid, "fish_name": fish_name}]))
                self._alerted[fid] = 0

        return events

    # ------------------------------------------------------------------

    def pop_interactions(self) -> list[dict]:
        """Drain pending interaction edges for DB persistence by orchestrator."""
        result = self._pending_interactions[:]
        self._pending_interactions.clear()
        return result

    def ingest_vlm_observation(self, obs) -> list[dict]:
        """
        Convert a VLMObservation into anomaly event dicts (same shape as
        update() returns) so they flow through the existing WS broadcast path.
        """
        if not obs or not obs.anomalies:
            return []
        return [
            {
                **self._make("vlm_observation", "low", []),
                "description": anomaly,
                "source": "vlm",
                "vlm_confidence": obs.confidence,
            }
            for anomaly in obs.anomalies
        ]

    # ------------------------------------------------------------------

    @staticmethod
    def _make(event_type: str, severity: str, involved: list[dict]) -> dict:
        return {
            "uuid":          str(uuid.uuid4()),
            "event_type":    event_type,
            "severity":      severity,
            "started_at":    datetime.now(timezone.utc).isoformat(),
            "involved_fish": involved,
            "zone_id":       None,
        }


def _initiator(ea: dict, eb: dict) -> str | None:
    """Heuristic: the faster-moving fish is likely the initiator (chaser)."""
    sa = ea.get("speed_px_per_frame", 0.0)
    sb = eb.get("speed_px_per_frame", 0.0)
    if abs(sa - sb) < 0.5:
        return None  # too similar to determine
    return ea["identity"]["fish_id"] if sa > sb else eb["identity"]["fish_id"]
