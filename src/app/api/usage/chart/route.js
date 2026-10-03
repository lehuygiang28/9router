import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { viewerTimeZoneFromRequest } from "@/lib/api/viewerTimeZone.js";
import { parseUsagePeriodFromSearchParams } from "@/lib/api/usageQuery.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tz = viewerTimeZoneFromRequest(request);
    const parsed = parseUsagePeriodFromSearchParams(searchParams, tz);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const demoDelayMs = Number(process.env.USAGE_STATS_DEMO_DELAY_MS || 0);
    if (demoDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, demoDelayMs));
    }

    const data = await getChartData(parsed.period, tz, parsed.customRange);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 400 });
  }
}
