"""
Stream endpoints — MJPEG video + HLS video + WebSocket real-time channel.
Stubs for M1; observation engine wires these in M2.

Endpoints
---------
GET  /stream/video          — MJPEG (camera 1, legacy, kept for compatibility)
GET  /stream/video2         — MJPEG (camera 2)
GET  /stream/hls/{filename} — HLS playlist + segments for camera 1
GET  /stream/hls2/{filename} — HLS playlist + segments for camera 2
GET  /stream/status         — pipeline status
POST /stream/start          — start pipeline
POST /stream/stop           — stop pipeline
WS   /stream/ws             — real-time observation WebSocket
"""
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from convict.engines.experience.ws_broadcaster import broadcaster

router = APIRouter(prefix="/stream", tags=["stream"])


# ── MJPEG (kept for backwards compatibility) ──────────────────────────────────

@router.get("/video")
async def video_stream():
    from convict.engines.observation.mjpeg_streamer import streamer
    return StreamingResponse(
        streamer.frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/video2")
async def video_stream_2():
    from convict.engines.observation.mjpeg_streamer import streamer2
    return StreamingResponse(
        streamer2.frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── HLS ───────────────────────────────────────────────────────────────────────

def _hls_media_type(filename: str) -> str:
    if filename.endswith(".m3u8"):
        return "application/vnd.apple.mpegurl"
    if filename.endswith(".ts"):
        return "video/mp2t"
    return "application/octet-stream"


@router.get("/hls/{filename}")
async def hls_segment(filename: str):
    """
    Serve HLS playlist (.m3u8) and transport-stream segments (.ts) for camera 1.

    These files are written by the HLSStreamer into a temp directory.
    Returns 503 if the HLS output directory does not yet exist (ffmpeg not
    started or ffmpeg not available on the host).
    """
    from convict.engines.observation.hls_streamer import hls_streamer

    # Guard: only allow plain filenames to prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        return JSONResponse({"error": "invalid filename"}, status_code=400)

    file_path: Path = hls_streamer.hls_dir / filename
    if not file_path.exists():
        if not hls_streamer.ffmpeg_ok:
            return JSONResponse(
                {
                    "error": "HLS unavailable",
                    "detail": (
                        "ffmpeg was not found on PATH. "
                        "Install ffmpeg to enable HLS streaming. "
                        "The MJPEG endpoint (/api/v1/stream/video) is still available."
                    ),
                },
                status_code=503,
            )
        return JSONResponse(
            {"error": "segment not found", "detail": "Stream may not have started yet."},
            status_code=404,
        )

    return FileResponse(
        str(file_path),
        media_type=_hls_media_type(filename),
        headers={
            # Prevent aggressive caching — segments are short-lived
            "Cache-Control": "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/hls2/{filename}")
async def hls_segment_2(filename: str):
    """Serve HLS playlist and segments for camera 2."""
    from convict.engines.observation.hls_streamer import hls_streamer2

    if "/" in filename or "\\" in filename or ".." in filename:
        return JSONResponse({"error": "invalid filename"}, status_code=400)

    file_path: Path = hls_streamer2.hls_dir / filename
    if not file_path.exists():
        if not hls_streamer2.ffmpeg_ok:
            return JSONResponse(
                {"error": "HLS unavailable", "detail": "ffmpeg not found on PATH."},
                status_code=503,
            )
        return JSONResponse(
            {"error": "segment not found", "detail": "Stream may not have started yet."},
            status_code=404,
        )

    return FileResponse(
        str(file_path),
        media_type=_hls_media_type(filename),
        headers={
            "Cache-Control": "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/hls-status")
async def hls_status():
    """Returns whether HLS is available and actively producing segments."""
    from convict.engines.observation.hls_streamer import hls_streamer, hls_streamer2
    return JSONResponse({
        "ffmpeg_available": hls_streamer.ffmpeg_ok,
        "cam1_active": hls_streamer.is_active,
        "cam2_active": hls_streamer2.is_active,
        "cam1_playlist": str(hls_streamer.playlist_path),
        "cam2_playlist": str(hls_streamer2.playlist_path),
    })


# ── Pipeline control ──────────────────────────────────────────────────────────

@router.get("/status")
async def stream_status():
    from convict.pipeline.orchestrator import orchestrator
    return JSONResponse(orchestrator.status())


@router.post("/start")
async def start_pipeline():
    from convict.pipeline.orchestrator import orchestrator
    await orchestrator.start()
    return {"status": "started"}


@router.post("/stop")
async def stop_pipeline():
    from convict.pipeline.orchestrator import orchestrator
    await orchestrator.stop()
    return {"status": "stopped"}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await broadcaster.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; client sends acks
    except WebSocketDisconnect:
        broadcaster.disconnect(ws)
