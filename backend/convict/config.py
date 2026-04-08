from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    api_port: int = 8000
    admin_password: str = ""  # set ADMIN_PASSWORD=yourpassword in .env.local; empty = no auth
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"]
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Database
    db_path: Path = BASE_DIR / "data" / "convict.db"

    # Camera
    camera_index: int = 0
    capture_width: int = 1920
    capture_height: int = 1080
    mock_camera: bool = False  # set MOCK_CAMERA=1 in .env.local for dev without hardware
    camera_index_2: int = -1   # second camera device index; -1 = disabled

    # CV pipeline
    detector_type: Literal["mog2", "yolo", "yolo_onnx", "rfdetr"] = "mog2"
    yolo_model_path: Path = BASE_DIR / "data" / "models" / "yolov8n.pt"
    yolo_confidence: float = 0.35
    yolo_iou: float = 0.45
    rfdetr_model_size: Literal["base", "large"] = "base"
    rfdetr_confidence_threshold: float = 0.35
    inference_width: int = 512
    detection_interval_ms: int = 80   # ~12fps
    mjpeg_quality: int = 92
    mjpeg_fps: int = 12

    # Background subtractor tuning
    bg_var_threshold: int = 50        # higher = less sensitive
    bg_min_area: int = 600            # min blob area px² in original frame coords
    bg_max_area: int = 120_000        # max blob area (ignore near-full-frame detections)
    bg_warmup_frames: int = 80        # frames to learn background before emitting

    # Nighttime mode
    # Priority: schedule → NXT sensor → frame brightness fallback
    night_start_hour: int = 22            # lights off (10 pm)
    night_end_hour: int = 7              # lights on  (7 am)
    night_brightness_threshold: int = 55  # frame-brightness fallback (mean luma)
    night_bg_var_threshold: int = 120     # higher MOG2 threshold for noisy night frames

    # Camera exposure switching (values are camera-specific; -1 = don't touch)
    day_exposure: float  = -1.0           # daytime exposure  (-1 = leave on auto)
    day_gain: float      = -1.0           # daytime gain
    night_exposure: float = -4.0          # nighttime: longer exposure (~1/16s typical)
    night_gain: float     = 150.0         # nighttime: raise gain (0-255)

    # NXT color sensor (optional — overrides schedule if connected)
    nxt_sensor_port: int = 1
    nxt_night_lux_threshold: int = 30

    # Tracker
    tracker_max_age: int = 30
    tracker_min_hits: int = 3         # entity must be seen 3 consecutive frames before showing
    trail_length: int = 30       # centroids kept in WS payload
    centroid_history_len: int = 150  # in-memory centroid deque per track

    # Identity resolver
    identity_min_confidence: float = 0.55
    identity_ema_alpha: float = 0.15  # weight of new observation vs history

    # Cost weights (must sum to 1.0)
    cost_weight_size: float = 0.20
    cost_weight_zone: float = 0.30
    cost_weight_color: float = 0.35
    cost_weight_path: float = 0.15

    # Anomaly thresholds
    anomaly_zone_sigma: float = 2.0
    anomaly_speed_sigma: float = 3.0
    harassment_distance_px: float = 20.0
    harassment_duration_frames: int = 60
    missing_fish_frames: int = 3000  # ~10min at 5fps

    # Baseline
    baseline_flush_interval_frames: int = 300   # flush to DB every ~1min
    anomaly_check_interval_frames: int = 60      # check every ~12s

    # AutoRegistrar
    auto_register_min_stable_frames: int = 60    # ~5s at 12fps before auto-creating fish
    auto_register_color_dedup_threshold: float = 0.25  # L1 hist distance below this = same fish
    auto_register_hist_sample_frames: int = 30   # last N bboxes to average histogram from

    # VLM (Gemma via Ollama — optional, cross-platform)
    # Setup: install Ollama (https://ollama.com), then: ollama pull gemma3:2b
    vlm_enabled: bool = False
    vlm_model: str = "gemma3:2b"
    vlm_ollama_url: str = "http://localhost:11434"
    vlm_analysis_interval_s: float = 20.0
    vlm_max_tokens: int = 256

    # Prediction engine
    prediction_interval_seconds: int = 300       # run every 5min
    aggression_streak_threshold: int = 3
    isolation_window_threshold: int = 3

    # Smart plugs (TP-Link Kasa — requires: pip install python-kasa)
    # Set in .env.local — leave empty to disable
    kasa_plug_1_ip:    str = ""          # e.g. 192.168.1.100
    kasa_plug_1_label: str = "air_pump"
    kasa_plug_2_ip:    str = ""          # e.g. 192.168.1.101
    kasa_plug_2_label: str = "light"

    @property
    def database_url(self) -> str:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.db_path}"


settings = Settings()
