from convict.models.tank import Tank
from convict.models.known_fish import KnownFish
from convict.models.zone import Zone
from convict.models.schedule import Schedule
from convict.models.detection_frame import DetectionFrame
from convict.models.track import Track
from convict.models.identity_hypothesis import IdentityHypothesis
from convict.models.behavior_baseline import BehaviorBaseline
from convict.models.behavior_event import BehaviorEvent
from convict.models.behavior_pattern import BehaviorPattern
from convict.models.prediction import Prediction
from convict.models.evidence_bundle import EvidenceBundle
from convict.models.camera_placement import CameraPlacement
from convict.models.tank_obstacle import TankObstacle
from convict.models.interaction_edge import InteractionEdge
from convict.models.community_health_snapshot import CommunityHealthSnapshot

__all_models__ = [
    Tank, KnownFish, Zone, Schedule, DetectionFrame, Track,
    IdentityHypothesis, BehaviorBaseline, BehaviorEvent,
    BehaviorPattern, Prediction, EvidenceBundle,
    CameraPlacement, TankObstacle,
    InteractionEdge, CommunityHealthSnapshot,
]

__all__ = [m.__name__ for m in __all_models__]
