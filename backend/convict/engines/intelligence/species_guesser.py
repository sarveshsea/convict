"""
SpeciesGuesser — heuristic color+size → species inference.

Runs in the predict_loop every 5min. For each auto-detected fish with
species == "Unknown", derives a dominant color from the stored HSV histogram
and cross-references against a hardcoded cichlid species lookup table.

No ML model needed; no external API calls. Works offline on CPU.
Confidence is honest: 0.6 for unique match, 0.45 for 2 candidates, 0.30 for 3+.
"""
from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# HSV hue → color name  (OpenCV hue range 0–180)
# ---------------------------------------------------------------------------

_HUE_BINS = [
    (0,   10,  "red"),
    (11,  25,  "orange"),
    (26,  34,  "yellow"),
    (35,  85,  "green"),
    (86,  130, "blue"),
    (131, 159, "purple"),
    (160, 180, "red"),   # wrap-around
]

# Saturation bins 0–2 (out of 16) cover 0–48/256 ≈ low saturation = silver/white/albino
_SILVER_LOW_SAT_FRAC = 0.55


def _dominant_color(hist: np.ndarray) -> str:
    """
    hist: 288-element float32 array (18 hue × 16 sat bins, normalised).
    Returns a color name string.
    """
    h_sat = hist.reshape(18, 16)

    # Check for near-achromatic (silver/white/albino) fish
    sat_marginal = h_sat.sum(axis=0)   # shape (16,)
    if float(sat_marginal[:3].sum()) > _SILVER_LOW_SAT_FRAC:
        return "silver"

    hue_marginal = h_sat.sum(axis=1)   # shape (18,)
    dominant_bin = int(np.argmax(hue_marginal))
    hue_center   = dominant_bin * 10   # 0 → 0°, 17 → 170°

    for lo, hi, name in _HUE_BINS:
        if lo <= hue_center <= hi:
            return name
    return "green"  # safe fallback


# ---------------------------------------------------------------------------
# Cichlid species lookup  (size_class, color) → candidates (most→least likely)
# ---------------------------------------------------------------------------

CICHLID_SPECIES_HINTS: dict[tuple[str, str], list[str]] = {
    ("large", "orange"): [
        "Astronotus ocellatus (Oscar)",
        "Amphilophus citrinellus (Midas Cichlid)",
        "Amphilophus labiatus (Red Devil)",
    ],
    ("large", "red"): [
        "Cichlasoma festae (Red Terror)",
        "Thorichthys meeki (Firemouth Cichlid)",
    ],
    ("large", "silver"): [
        "Cyphotilapia frontosa (Frontosa)",
        "Parachromis managuensis (Jaguar Cichlid)",
        "Parachromis dovii (Wolf Cichlid)",
    ],
    ("large", "blue"): [
        "Nimbochromis venustus (Venustus)",
        "Herichthys cyanoguttatus (Texas Cichlid)",
    ],
    ("large", "yellow"): [
        "Astronotus ocellatus 'Gold Oscar'",
        "Heros efasciatus 'Gold Severum'",
    ],
    ("large", "green"): [
        "Andinoacara rivulatus (Green Terror)",
        "Heros efasciatus (Severum)",
        "Geophagus brasiliensis",
    ],
    ("large", "purple"): [
        "Cyphotilapia frontosa (Frontosa)",
    ],
    ("medium", "blue"): [
        "Andinoacara sp. 'Electric Blue' (Electric Blue Acara)",
        "Andinoacara pulcher (Blue Acara)",
        "Aulonocara nyassae (Peacock Cichlid)",
    ],
    ("medium", "yellow"): [
        "Labidochromis caeruleus (Electric Yellow Lab)",
        "Aulonocara sp. (OB Peacock)",
    ],
    ("medium", "orange"): [
        "Aulonocara sp. (OB Peacock Cichlid)",
        "Etroplus maculatus (Orange Chromide)",
    ],
    ("medium", "silver"): [
        "Pterophyllum scalare (Angelfish)",
        "Pseudotropheus crabro (Bumblebee)",
    ],
    ("medium", "green"): [
        "Mesonauta festivus (Festivus Cichlid)",
        "Geophagus altifrons",
    ],
    ("medium", "red"): [
        "Thorichthys meeki (Firemouth Cichlid)",
        "Maylandia estherae (Red Zebra)",
    ],
    ("medium", "purple"): [
        "Tropheus duboisi",
        "Tropheus moorii",
    ],
    ("small", "blue"): [
        "Mikrogeophagus ramirezi (German Blue Ram)",
        "Cynotilapia afra",
    ],
    ("small", "yellow"): [
        "Labidochromis caeruleus (Electric Yellow Lab)",
        "Mikrogeophagus altispinosus (Bolivian Ram)",
    ],
    ("small", "orange"): [
        "Apistogramma cacatuoides (Cockatoo Apisto)",
        "Apistogramma agassizii",
    ],
    ("small", "silver"): [
        "Amatitlania nigrofasciata albino (Convict)",
        "Laetacara curviceps",
    ],
    ("small", "red"): [
        "Melanochromis auratus",
        "Maylandia estherae (Red Zebra)",
    ],
    ("small", "green"): [
        "Mikrogeophagus ramirezi (Green Ram)",
        "Dicrossus filamentosus (Checkerboard)",
    ],
}


# ---------------------------------------------------------------------------

class SpeciesGuesser:
    """Heuristic species inference — runs in predict_loop, no ML required."""

    def __init__(self):
        # Latest VLM species hints (set by VLMAnalyzer via orchestrator)
        self._vlm_hints: list[str] = []

    def set_vlm_hints(self, hints: list[str]) -> None:
        """Called by the orchestrator after each VLM analysis cycle."""
        self._vlm_hints = [h.lower() for h in hints]

    async def run(self, db) -> list[dict]:
        """
        For each auto_detected fish with species == 'Unknown', attempt a guess.
        Updates DB in-place; returns list of update dicts for WS broadcast.
        """
        from sqlalchemy import select
        from convict.models.known_fish import KnownFish

        rows = (await db.execute(
            select(KnownFish).where(
                KnownFish.auto_detected == True,   # noqa: E712
                KnownFish.is_active    == True,
                KnownFish.color_histogram != None,  # noqa: E711
                KnownFish.species.in_(["Unknown", ""]),
            )
        )).scalars().all()

        updates: list[dict] = []
        for fish in rows:
            result = self._guess(fish)
            if result is None:
                continue
            species_str, confidence = result
            fish.species = species_str
            fish.species_guess_confidence = confidence
            updates.append({
                "fish_uuid":  fish.uuid,
                "fish_name":  fish.name,
                "species":    species_str,
                "confidence": confidence,
            })

        if updates:
            try:
                await db.commit()
            except Exception:
                await db.rollback()

        return updates

    # ------------------------------------------------------------------

    def _guess(self, fish) -> tuple[str, float] | None:
        hist = np.frombuffer(fish.color_histogram, dtype=np.float32)
        if hist.size != 288:
            return None

        color = _dominant_color(hist)
        key   = (fish.size_class, color)
        candidates = CICHLID_SPECIES_HINTS.get(key)
        if not candidates:
            return None

        n = len(candidates)
        if n == 1:
            base_conf = 0.6
            label = candidates[0]
        elif n == 2:
            base_conf = 0.45
            label = f"Possible: {candidates[0]}"
        else:
            base_conf = 0.30
            label = f"Possible: {candidates[0]}"

        # Boost confidence if VLM independently mentioned the same species
        if self._vlm_hints:
            candidate_lower = candidates[0].lower()
            if any(hint in candidate_lower or candidate_lower in hint
                   for hint in self._vlm_hints):
                base_conf = min(0.85, base_conf + 0.15)

        return label, base_conf
