"""
Anomaly detector.

Runs two tiers:
  Every frame   — track missing-fish counters, pairwise proximity counters,
                  centroid-y history for surface detection
  Every 60 frames (~12s) — evaluate thresholds and emit events

Detected event types:
  missing_fish        — known fish unseen for missing_fish_frames
  harassment          — two identified fish within harassment_distance_px
                        for harassment_duration_frames consecutive frames
  lethargy            — identified fish speed > 3σ below baseline mean
  hyperactivity       — identified fish speed > 3σ above baseline mean
  synchronized_stress — ≥50% of identified fish stressed simultaneously
                        (water quality proxy — check O₂, ammonia, temperature)
  erratic_motion      — fish trail shows repeated rapid direction reversals
                        (neurological stress, medication reaction, spawn frenzy)
  surface_gathering   — multiple fish clustered in top 25% of observed frame height
                        (hypoxia proxy — low dissolved oxygen)

Interaction edges (drained by orchestrator via pop_interactions()):
  harassment  — emitted when harassment threshold fires
  proximity   — emitted when a close pair separates after >=15 frames together
"""
from __future__ import annotations

import math
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone

from convict.engines.intelligence.baseline_builder import BaselineBuilder

# Minimum close frames before a separating pair gets a "proximity" edge recorded
_MIN_PROXIMITY_FRAMES = 15


def _is_erratic(trail: list) -> bool:
    """
    True if the trail shows repeated rapid direction reversals.

    Computes the mean angle between consecutive trail segments. A high mean
    angle (> ~80°) means the fish is oscillating back and forth — characteristic
    of flashing/scratching, neurological stress, or spawn-frenzy darting.
    """
    if len(trail) < 6:
        return False
    angles = []
    for i in range(1, len(trail) - 1):
        dx1 = trail[i][0]   - trail[i - 1][0]
        dy1 = trail[i][1]   - trail[i - 1][1]
        dx2 = trail[i + 1][0] - trail[i][0]
        dy2 = trail[i + 1][1] - trail[i][1]
        m1 = (dx1 ** 2 + dy1 ** 2) ** 0.5
        m2 = (dx2 ** 2 + dy2 ** 2) ** 0.5
        if m1 < 1.0 or m2 < 1.0:
            continue  # standing still — skip segment
        cos_a = (dx1 * dx2 + dy1 * dy2) / (m1 * m2)
        angles.append(math.acos(max(-1.0, min(1.0, cos_a))))
    if len(angles) < 3:
        return False
    return (sum(angles) / len(angles)) > 1.4   # ~80° avg turn = erratic


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

        # ── Vision-only water quality / health signals ───────────────────────
        # Rolling centroid y-values for surface-gathering detection
        self._centroid_ys: deque = deque(maxlen=600)
        # Cooldown counters (in check-interval ticks, not raw frames)
        self._surface_cooldown:      int = 0
        self._synced_stress_cooldown: int = 0
        # fish_uuid -> consecutive erratic check cycles
        self._erratic_counts: dict[str, int] = defaultdict(int)

        # ── Feeding anticipation ──────────────────────────────────────────────
        # Schedules injected by orchestrator; checked at each anomaly interval
        self._schedules:        list = []
        # Track whether we already fired a feeding_indifference event for this
        # feeding window (reset when no feeding is imminent any more)
        self._feeding_checked:  bool = False
        self._feeding_indiff_cooldown: int = 0

    # ------------------------------------------------------------------

    def update_schedules(self, schedules: list) -> None:
        """Called by orchestrator when schedules are loaded/refreshed."""
        self._schedules = schedules

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def prune_unknown_uuids(self, known_uuids: set[str]) -> int:
        """Drop per-fish state whose key isn't in known_uuids. Returns prune count."""
        pruned = 0
        for d in (self._unseen, self._alerted, self._erratic_counts):
            for stale in [k for k in list(d.keys()) if k not in known_uuids]:
                del d[stale]
                pruned += 1
        return pruned

    def update(self, entities: list[dict]) -> list[dict]:
        """
        Call every frame. Returns list of new anomaly event dicts
        (empty the vast majority of the time).
        """
        self._frame += 1
        events: list[dict] = []

        # ── Track centroid y values every frame (surface detection) ────
        for e in entities:
            self._centroid_ys.append(e["centroid"][1])

        # Decrement cooldowns every frame
        if self._surface_cooldown      > 0: self._surface_cooldown      -= 1
        if self._synced_stress_cooldown > 0: self._synced_stress_cooldown -= 1

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

        # --- Speed deviation + erratic motion check -------------------
        stressed_count = 0  # for synchronized_stress
        active_fids: set[str] = set()

        for e in ident:
            fid  = e["identity"]["fish_id"]
            conf = e["identity"].get("confidence", 0.0)
            active_fids.add(fid)
            if conf < 0.6:
                continue

            mean, std = self._baseline.speed_stats(fid)
            speed = e.get("speed_px_per_frame", 0.0)
            sigma = self._s.anomaly_speed_sigma

            # Count stressed fish (regardless of cooldown — for synchronized_stress)
            if std >= 0.5:
                if speed < mean - sigma * std or speed > mean + sigma * std:
                    stressed_count += 1

            # Individual alerts (respects cooldown)
            if fid not in self._alerted and std >= 0.5:
                fish_name = e["identity"]["fish_name"]
                if speed < mean - sigma * std:
                    events.append(self._make("lethargy", "medium",
                                              [{"fish_id": fid, "fish_name": fish_name}]))
                    self._alerted[fid] = 0
                elif speed > mean + sigma * std:
                    events.append(self._make("hyperactivity", "medium",
                                              [{"fish_id": fid, "fish_name": fish_name}]))
                    self._alerted[fid] = 0

            # ── Erratic motion detection ───────────────────────────────
            trail = e.get("trail", [])
            if _is_erratic(trail):
                self._erratic_counts[fid] += 1
                # Require 3 consecutive erratic check cycles to fire (avoids one-off bursts)
                if self._erratic_counts[fid] == 3:
                    events.append(self._make("erratic_motion", "medium",
                                              [{"fish_id": fid,
                                                "fish_name": e["identity"]["fish_name"]}]))
            else:
                if self._erratic_counts.get(fid, 0) > 0:
                    self._erratic_counts[fid] = max(0, self._erratic_counts[fid] - 1)

        # Clean up erratic counts for fish no longer in frame
        for fid in list(self._erratic_counts):
            if fid not in active_fids:
                del self._erratic_counts[fid]

        # ── Synchronized stress (water quality proxy) ──────────────────
        # Fires when ≥50% of identified fish are simultaneously outside their
        # individual speed baselines. Individual fish illness rarely hits half
        # the tank at once — environmental cause is most likely.
        if (len(ident) >= 2 and stressed_count >= max(2, len(ident) // 2 + 1)
                and self._synced_stress_cooldown == 0):
            events.append(self._make(
                "synchronized_stress", "high",
                [{"fish_id": e["identity"]["fish_id"],
                  "fish_name": e["identity"]["fish_name"]}
                 for e in ident if e["identity"].get("fish_id")],
            ))
            self._synced_stress_cooldown = 120   # ~20min at default check interval

        # ── Surface gathering (hypoxia proxy) ──────────────────────────
        # Fish compressed toward the top of the tank = seeking oxygen at surface.
        # Uses relative y-position within the observed centroid range to avoid
        # needing explicit frame dimensions.
        if (len(self._centroid_ys) > 100 and len(ident) >= 2
                and self._surface_cooldown == 0):
            ys     = list(self._centroid_ys)
            y_min  = min(ys)
            y_max  = max(ys)
            y_rng  = max(y_max - y_min, 1.0)
            # In OpenCV y=0 is top of frame; "surface" = small y values
            surface_thresh = y_min + y_rng * 0.25
            current_ys     = [e["centroid"][1] for e in ident]
            surface_count  = sum(1 for y in current_ys if y <= surface_thresh)
            if surface_count >= max(2, len(current_ys) // 2 + 1):
                events.append(self._make(
                    "surface_gathering", "high",
                    [{"fish_id": e["identity"]["fish_id"],
                      "fish_name": e["identity"]["fish_name"]}
                     for e in ident if e["identity"].get("fish_id")],
                ))
                self._surface_cooldown = 120

        # ── Feeding anticipation (indifference = health warning) ────────
        # Fires when a feeding is due in ≤5 minutes but fish are showing
        # below-baseline activity (not clustering/begging). This is an early
        # sign of illness, stress, or appetite loss.
        if self._feeding_indiff_cooldown > 0:
            self._feeding_indiff_cooldown -= 1
        feed_mins = _minutes_to_next_feeding(self._schedules)
        if feed_mins is not None and 0 <= feed_mins <= 5:
            if not self._feeding_checked and self._feeding_indiff_cooldown == 0 and len(ident) >= 2:
                sluggish, active = 0, 0
                for e in ident:
                    fid   = e["identity"]["fish_id"]
                    mean, std = self._baseline.speed_stats(fid)
                    speed = e.get("speed_px_per_frame", 0.0)
                    if std >= 0.3:
                        if speed < mean - 0.5 * std:
                            sluggish += 1
                        else:
                            active += 1
                total = sluggish + active
                if total >= 2 and sluggish / total >= 0.60:
                    events.append(self._make(
                        "feeding_indifference", "medium",
                        [{"fish_id": e["identity"]["fish_id"],
                          "fish_name": e["identity"]["fish_name"]}
                         for e in ident],
                    ))
                    self._feeding_indiff_cooldown = 600   # don't re-fire for 10min
                self._feeding_checked = True
        else:
            self._feeding_checked = False

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


def _minutes_to_next_feeding(schedules: list) -> float | None:
    """
    Returns minutes until the next feeding event today, or None if no feeding
    is scheduled within the next 30 minutes.
    Negative return = feeding was in the past (within last 30 min).
    """
    from datetime import datetime as _dt
    if not schedules:
        return None
    now   = _dt.now()
    today = now.strftime("%a").lower()[:3]
    best  = None
    for s in schedules:
        if s.event_type != "feeding":
            continue
        days = s.days_of_week if isinstance(s.days_of_week, list) else []
        if days and today not in [d.lower()[:3] for d in days]:
            continue
        try:
            h, m = map(int, s.time_of_day.split(":"))
        except Exception:
            continue
        offset = (h * 60 + m) - (now.hour * 60 + now.minute)
        if -30 <= offset <= 30:
            if best is None or abs(offset) < abs(best):
                best = float(offset)
    return best


def _initiator(ea: dict, eb: dict) -> str | None:
    """Heuristic: the faster-moving fish is likely the initiator (chaser)."""
    sa = ea.get("speed_px_per_frame", 0.0)
    sb = eb.get("speed_px_per_frame", 0.0)
    if abs(sa - sb) < 0.5:
        return None  # too similar to determine
    return ea["identity"]["fish_id"] if sa > sb else eb["identity"]["fish_id"]
