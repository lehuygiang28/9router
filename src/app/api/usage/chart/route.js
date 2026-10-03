import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { viewerTimeZoneFromRequest } from "@/lib/api/viewerTimeZone.js";
import { parseUsagePeriodFromSearchParams } from "@/lib/api/usageQuery.js";
import { sleepUsageStatsDemoDelay } from "@/lib/api/usageDemoDelay.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tz = viewerTimeZoneFromRequest(request);
    const parsed = parseUsagePeriodFromSearchParams(searchParams, tz);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    await sleepUsageStatsDemoDelay();

    const data = await getChartData(parsed.period, tz, parsed.customRange);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 400 });
  }
}
