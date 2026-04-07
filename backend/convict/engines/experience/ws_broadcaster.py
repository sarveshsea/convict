"""
WebSocket broadcaster — manages client connections and pushes typed messages.
Full implementation in M2; this stub is sufficient for M1 startup.
"""
import asyncio
import json
from fastapi import WebSocket


class WSBroadcaster:
    def __init__(self):
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self._clients.discard(ws)

    async def broadcast(self, message: dict):
        if not self._clients:
            return
        payload = json.dumps(message)
        dead: set[WebSocket] = set()
        results = await asyncio.gather(
            *[client.send_text(payload) for client in self._clients],
            return_exceptions=True,
        )
        for client, result in zip(list(self._clients), results):
            if isinstance(result, Exception):
                dead.add(client)
        self._clients -= dead

    @property
    def connection_count(self) -> int:
        return len(self._clients)


broadcaster = WSBroadcaster()
