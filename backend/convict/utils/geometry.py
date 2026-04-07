"""
Geometric helpers used across engines.
All zone coordinates are fractional [0, 1] relative to frame dimensions.
"""
from __future__ import annotations


def point_in_zone(fx: float, fy: float, zone) -> bool:
    """Return True if fractional point (fx, fy) is inside a Zone ORM object."""
    return zone.x_min <= fx <= zone.x_max and zone.y_min <= fy <= zone.y_max


def zones_for_point(fx: float, fy: float, zones: list) -> list[str]:
    """Return list of zone UUIDs that contain fractional point (fx, fy)."""
    return [z.uuid for z in zones if point_in_zone(fx, fy, z)]


def iou(box_a: tuple[float, float, float, float],
        box_b: tuple[float, float, float, float]) -> float:
    """Intersection-over-Union for two (x1,y1,x2,y2) boxes."""
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0.0:
        return 0.0

    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union  = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def centroid_distance(
    cx1: float, cy1: float,
    cx2: float, cy2: float,
) -> float:
    return ((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2) ** 0.5
