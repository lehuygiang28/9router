import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

/** Avoid calling getUsageStats() on every statsEmitter "update" (D1-heavy); SSE still pushes live active/recent every time. */
const FULL_STATS_MIN_INTERVAL_MS = 5000;

export async function GET() {
  const encoder = new TextEncoder();
  const state = {
    closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null, lastFullStatsAt: 0,
  };

  const stream = new ReadableStream({
    async start(controller) {
      // Lightweight push every time; full D1-backed stats only on interval (or first load)
      state.send = async () => {
        if (state.closed) return;
        try {
          const now = Date.now();
          const needFull = !state.cachedStats || (now - state.lastFullStatsAt >= FULL_STATS_MIN_INTERVAL_MS);

          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }

          if (needFull) {
            const stats = await getUsageStats();
            state.cachedStats = stats;
            state.lastFullStatsAt = Date.now();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          }
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
