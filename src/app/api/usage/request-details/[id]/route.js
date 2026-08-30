import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details/:id
 * Full stored detail for the dashboard drawer (request/response bodies).
 * List route stays metadata-only; this route requires dashboard auth via middleware.
 */
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    if (!id || !String(id).trim()) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const detail = await getRequestDetailById(String(id).trim());
    if (!detail) {
      return NextResponse.json({ error: "Request detail not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[API] Failed to get request detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 },
    );
  }
}
