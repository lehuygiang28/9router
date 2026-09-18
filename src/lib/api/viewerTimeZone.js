import { resolveViewerTimeZone } from "@/lib/time.js";

/** Read viewer IANA zone from `timezone` query param or `X-Viewer-Timezone` header. */
export function viewerTimeZoneFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get("timezone");
  const fromHeader = request.headers.get("x-viewer-timezone");
  return resolveViewerTimeZone(fromQuery || fromHeader || undefined);
}
