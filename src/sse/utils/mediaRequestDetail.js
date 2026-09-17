import { buildRequestDetail } from "open-sse/handlers/chatCore/requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
const MAX_TEXT_PREVIEW = 500;
const MAX_EMBEDDING_PREVIEW = 4;

/** Shrink embedding vectors and image base64 blobs for observability storage. */
export function shrinkMediaPayload(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > MAX_TEXT_PREVIEW) {
      return `${value.slice(0, MAX_TEXT_PREVIEW)}… (${value.length} chars)`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => shrinkMediaPayload(item));
  }
  if (typeof value !== "object") return value;

  const out = { ...value };

  if (Array.isArray(out.data)) {
    out.data = out.data.map((item) => {
      if (!item || typeof item !== "object") return item;
      const next = { ...item };
      if (Array.isArray(next.embedding) && next.embedding.length > MAX_EMBEDDING_PREVIEW) {
        const dims = next.embedding.length;
        next.embedding = [
          ...next.embedding.slice(0, MAX_EMBEDDING_PREVIEW).map((v) => (typeof v === "number" ? v : v)),
          `… (${dims} dims)`,
        ];
      }
      if (typeof next.b64_json === "string" && next.b64_json.length > 64) {
        next.b64_json = `… (${next.b64_json.length} base64 chars)`;
      }
      return next;
    });
  }

  if (typeof out.audio === "string" && out.audio.length > 64) {
    out.audio = `… (${out.audio.length} base64 chars)`;
  }

  if (typeof out.text === "string") {
    out.text = shrinkMediaPayload(out.text);
  }

  return out;
}

export function buildMediaClientRequest(body, endpoint) {
  if (!body || typeof body !== "object") {
    return { endpoint, body: body ?? null };
  }
  const copy = { ...body };
  if (typeof copy.input === "string") {
    copy.input = shrinkMediaPayload(copy.input);
  } else if (Array.isArray(copy.input)) {
    copy.input = copy.input.map((s) => shrinkMediaPayload(s));
  }
  if (typeof copy.prompt === "string") {
    copy.prompt = shrinkMediaPayload(copy.prompt);
  }
  return { endpoint, ...copy };
}

function buildProviderRequestSnapshot(audit) {
  if (!audit?.providerRequest && !audit?.providerUrl) return null;
  return {
    url: audit.providerUrl || null,
    body: shrinkMediaPayload(audit.providerRequest ?? null),
  };
}

function isEventStreamResponse(response) {
  const contentType = response?.headers?.get?.("content-type") || "";
  return contentType.includes("text/event-stream");
}

/**
 * Persist a media-route request to the observability store (success or error).
 * Usage counters are optional and should only be passed for successful exact usage.
 */
export function recordMediaRequestDetail({
  endpoint,
  provider,
  model,
  connectionId,
  status,
  latencyMs,
  clientBody,
  audit,
  tokens,
  errorMessage,
  statusCode,
}) {
  const total = Math.max(0, latencyMs || 0);
  const tokenBlock = tokens || { prompt_tokens: 0, completion_tokens: 0 };

  const clientResponse = audit?.clientResponse
    ? shrinkMediaPayload(audit.clientResponse)
    : status === "error"
      ? { error: errorMessage, status: statusCode ?? null }
      : {};

  const detail = buildRequestDetail({
    provider,
    model,
    connectionId,
    latency: { ttft: total, total },
    tokens: tokenBlock,
    request: buildMediaClientRequest(clientBody, endpoint),
    providerRequest: buildProviderRequestSnapshot(audit),
    providerResponse: audit?.providerResponse != null
      ? shrinkMediaPayload(audit.providerResponse)
      : null,
    response: clientResponse,
    status: status === "error" ? "error" : "success",
  }, { endpoint });

  saveRequestDetail(detail).catch(() => {});
}

/** Read JSON from a Response without throwing; returns null on failure. */
export async function readResponseJsonSafe(response) {
  if (!response || typeof response.clone !== "function") return null;
  if (isEventStreamResponse(response)) return null;
  try {
    const clone = response.clone();
    const text = await clone.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function captureClientResponse(result, audit) {
  if (audit?.clientResponse) return audit.clientResponse;
  if (!result?.success || !result.response) return undefined;
  if (isEventStreamResponse(result.response)) {
    return {
      _stream: true,
      contentType: result.response.headers?.get?.("content-type") || "text/event-stream",
    };
  }
  const parsed = await readResponseJsonSafe(result.response);
  if (parsed) return shrinkMediaPayload(parsed);
  const contentType = result.response.headers?.get?.("content-type");
  return { _nonJson: true, contentType: contentType || null };
}

/** Record observability for a media core handler result (embeddings, image, tts, stt). */
export async function recordMediaCoreResult({
  endpoint,
  provider,
  model,
  connectionId,
  clientBody,
  result,
  attemptStartMs,
  audit,
  tokens,
}) {
  const clientResponse = await captureClientResponse(result, audit);

  recordMediaRequestDetail({
    endpoint,
    provider,
    model,
    connectionId,
    status: result?.success ? "success" : "error",
    latencyMs: audit?.latencyMs ?? (Date.now() - attemptStartMs),
    clientBody,
    audit: { ...audit, clientResponse },
    tokens: tokens || { prompt_tokens: 0, completion_tokens: 0 },
    errorMessage: result?.error,
    statusCode: result?.status,
  });
}

/** Fire-and-forget wrapper so SSE/image bodies are not read before the handler returns. */
export function scheduleMediaCoreResultRecording(options) {
  void recordMediaCoreResult(options).catch(() => {});
}
