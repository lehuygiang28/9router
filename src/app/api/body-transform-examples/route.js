import { NextResponse } from "next/server";
import { loadBodyTransformExamples } from "open-sse/utils/providerBodyTransformExamples.server.js";
import {
  BODY_TRANSFORM_TIMEOUT_MS,
  MAX_BODY_TRANSFORM_SCRIPT_CHARS,
} from "open-sse/utils/providerBodyTransform.shared.js";

export const dynamic = "force-dynamic";

/** GET — catalog of example scripts (content loaded from open-sse/body-transform-examples/). */
export async function GET() {
  try {
    const examples = loadBodyTransformExamples().map(({ id, label, description, afterHint, script, sample }) => ({
      id,
      label,
      description,
      afterHint,
      script,
      sample,
    }));
    return NextResponse.json({
      examples,
      limits: {
        language: "javascript",
        maxScriptChars: MAX_BODY_TRANSFORM_SCRIPT_CHARS,
        timeoutMs: BODY_TRANSFORM_TIMEOUT_MS,
        sandbox: true,
        failOpen: true,
      },
    });
  } catch (err) {
    console.log("body-transform-examples:", err);
    return NextResponse.json({ error: "Failed to load examples" }, { status: 500 });
  }
}
