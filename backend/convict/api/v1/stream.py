"""
Stream endpoints — MJPEG video + WebSocket real-time channel.
Stubs for M1; observation engine wires these in M2.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse
from convict.engines.experience.ws_broadcaster import broadcaster

router = APIRouter(prefix="/stream", tags=["stream"])


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


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await broadcaster.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; client sends acks
    except WebSocketDisconnect:
        broadcaster.disconnect(ws)
