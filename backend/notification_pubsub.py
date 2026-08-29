"""Faz 9 CP4.17 — In-memory notification pub/sub for live SSE push.

Purpose
-------
The notification bell already polls `/api/notifications/unread-count` every
60 seconds, which is fine for background awareness but feels sluggish when a
manager is actively waiting on a cross-company permission response. This
module keeps an in-memory registry of per-user `asyncio.Queue` subscribers
so that whenever `_insert_notification` succeeds we can push the fresh row
directly to any open SSE stream for that user.

Design notes
------------
* Pure in-memory: this is a single-process FastAPI app (uvicorn worker=1
  under supervisor). If we ever scale horizontally, swap this for Redis
  pub/sub without changing the caller API.
* Publish is non-blocking (`put_nowait`) and silently drops on full queues
  so a stalled client can never back-pressure the writer.
* The subscriber MUST call `unsubscribe(...)` in a `finally` block to avoid
  leaking queues when the SSE connection closes.
* Faz 9 CP4.18 — a per-user cap (`MAX_CONNECTIONS_PER_USER`) prevents a
  single account from opening thousands of long-lived streams. When the
  cap is hit we evict the oldest queue with a sentinel event so its SSE
  loop can shut down gracefully.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# Faz 9 CP4.18 — hard cap on concurrent SSE streams per user. Legitimate
# users need one connection per open tab / device; 5 comfortably covers
# desktop + phone + laptop + a couple of spare tabs, while shutting down
# an abusive client that tries to open hundreds.
MAX_CONNECTIONS_PER_USER = 5

# Sentinel event pushed onto an evicted queue so the SSE reader can exit
# its `wait_for(q.get())` loop and close the response cleanly.
CLOSE_SENTINEL = "__sertex_close__"


class NotificationPubSub:
    def __init__(self) -> None:
        self._subs: Dict[str, List[asyncio.Queue]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def subscribe(self, user_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        evict: List[asyncio.Queue] = []
        async with self._lock:
            bucket = self._subs[user_id]
            # Faz 9 CP4.18 — if this user is already at the cap, take the
            # oldest connection out of the bucket and mark it for eviction.
            # We do the actual sentinel push OUTSIDE the lock so we never
            # block subscribe() on a slow queue.
            while len(bucket) >= MAX_CONNECTIONS_PER_USER:
                evict.append(bucket.pop(0))
            bucket.append(q)
        for old_q in evict:
            try:
                old_q.put_nowait({"kind": CLOSE_SENTINEL, "reason": "cap_exceeded"})
                logger.info(
                    "SSE cap reached for user=%s — evicted oldest stream",
                    user_id,
                )
            except asyncio.QueueFull:
                # Full queue → the client is already stuck; nothing more we
                # can do to signal it. It will disconnect on its own timeout.
                pass
        return q

    async def unsubscribe(self, user_id: str, q: asyncio.Queue) -> None:
        async with self._lock:
            bucket = self._subs.get(user_id)
            if not bucket:
                return
            try:
                bucket.remove(q)
            except ValueError:
                pass  # bilerek sessiz: kuyruk zaten çıkarılmış olabilir, zararsız
            if not bucket:
                self._subs.pop(user_id, None)

    async def publish(self, user_id: str, event: Dict[str, Any]) -> int:
        """Fan-out `event` to every subscriber of `user_id`. Returns the
        number of queues successfully written. Drops silently on full
        queues so a slow SSE client can never block a notification insert."""
        async with self._lock:
            queues = list(self._subs.get(user_id, []))
        delivered = 0
        for q in queues:
            try:
                q.put_nowait(event)
                delivered += 1
            except asyncio.QueueFull:
                logger.warning("notification queue full for user=%s (dropped)", user_id)
        return delivered

    def subscriber_count(self, user_id: str) -> int:
        return len(self._subs.get(user_id, []))


pubsub = NotificationPubSub()
