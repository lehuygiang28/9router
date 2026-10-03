/** Max artificial delay for usage stats/chart routes (demo recordings only). */
export const USAGE_STATS_DEMO_DELAY_MS_CAP = 5000;

export function usageStatsDemoDelayMs() {
  const raw = Number(process.env.USAGE_STATS_DEMO_DELAY_MS || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), USAGE_STATS_DEMO_DELAY_MS_CAP);
}

export async function sleepUsageStatsDemoDelay() {
  const ms = usageStatsDemoDelayMs();
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
