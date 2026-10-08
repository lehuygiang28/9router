import { NextResponse } from "next/server";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { isCustomCompatibleProvider } from "open-sse/utils/providerBodyRules.js";
import {
  applyBodyTransformScript,
  normalizeBodyTransform,
} from "open-sse/utils/providerBodyTransform.js";

export const dynamic = "force-dynamic";

/**
 * POST — dry-run body transform script against a sample JSON body.
 * Body: { sampleBody: object, bodyTransform?: { enabled, script } }
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const canonical = resolveProviderAlias(id);
    if (!isCustomCompatibleProvider(canonical)) {
      return NextResponse.json({ error: "Body transform is only for custom compatible providers" }, { status: 400 });
    }
    const payload = await request.json().catch(() => ({}));
    const sampleBody = payload.sampleBody;
    if (!sampleBody || typeof sampleBody !== "object" || Array.isArray(sampleBody)) {
      return NextResponse.json({ error: "sampleBody must be a JSON object" }, { status: 400 });
    }
    const { bodyTransform, error } = normalizeBodyTransform(payload.bodyTransform ?? {});
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!bodyTransform?.script || bodyTransform.enabled === false) {
      return NextResponse.json({ error: "bodyTransform.script is required" }, { status: 400 });
    }

    const before = structuredClone(sampleBody);
    const after = applyBodyTransformScript(before, bodyTransform.script);
    return NextResponse.json({ ok: true, body: after });
  } catch (err) {
    console.log("body-transform-preview:", err);
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
