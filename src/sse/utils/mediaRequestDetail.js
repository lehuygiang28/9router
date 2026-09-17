import { buildRequestDetail } from "open-sse/handlers/chatCore/requestDetail.js";
import { saveRequestDetail, isObservabilityEnabled } from "@/lib/usageDb.js";

const MAX_TEXT_PREVIEW = 500;
const MAX_EMBEDDING_PREVIEW = 4;
const MAX_INLINE_BINARY_PREVIEW = 64;

const SENSITIVE_URL_QUERY = new Set([
  "key", "api_key", "apikey", "access_token", "token", "secret", "auth", "credential",
]);

/** Remove API keys and tokens from provider URLs before persistence (e.g. Gemini `?key=`). */
export function sanitizeUrlForStorage(url) {
  if (!url || typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    for (const param of [...parsed.searchParams.keys()]) {
      const lower = param.toLowerCase();
      if (SENSITIVE_URL_QUERY.has(lower) || lower.includes("apikey") || lower.endsWith("_key")) {
        parsed.searchParams.set(param, "***");
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(
      /([?&](?:key|api_key|apikey|access_token|token|secret)=)[^&]*/gi,
      "$1***"
    );
  }
}

function shrinkBinaryField(value) {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_INLINE_BINARY_PREVIEW) return value;
  return `… (${value.length} chars)`;
}

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
      if (typeof next.b64_json === "string" && next.b64_json.length > MAX_INLINE_BINARY_PREVIEW) {
        next.b64_json = shrinkBinaryField(next.b64_json);
      }
      return next;
    });
  }

  if (typeof out.audio === "string" && out.audio.length > MAX_INLINE_BINARY_PREVIEW) {
    out.audio = shrinkBinaryField(out.audio);
  }

  if (typeof out.text === "string") {
    out.text = shrinkMediaPayload(out.text);
  }

  return out;
}

const IMAGE_BODY_KEYS = new Set([
  "image", "images", "mask", "image_url", "image_urls", "reference_image", "reference_images",
]);

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
  for (const key of Object.keys(copy)) {
    if (!IMAGE_BODY_KEYS.has(key)) continue;
    const val = copy[key];
    if (typeof val === "string") {
      copy[key] = shrinkBinaryField(val);
    } else if (Array.isArray(val)) {
      copy[key] = val.map((item) => {
        if (typeof item === "string") return shrinkBinaryField(item);
        if (item && typeof item === "object") {
          const next = { ...item };
          if (typeof next.url === "string") next.url = shrinkMediaPayload(next.url);
          if (typeof next.image_url === "string") next.image_url = shrinkBinaryField(next.image_url);
          if (typeof next.b64_json === "string") next.b64_json = shrinkBinaryField(next.b64_json);
          return next;
        }
        return item;
      });
    } else if (val && typeof val === "object" && typeof val.url === "string") {
      copy[key] = { ...val, url: shrinkMediaPayload(val.url) };
    }
  }
  return { endpoint, ...copy };
}

function buildProviderRequestSnapshot(audit) {
  if (!audit?.providerRequest && !audit?.providerUrl) return null;
  return {
    url: sanitizeUrlForStorage(audit.providerUrl || null),
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
  if (!(await isObservabilityEnabled())) return;

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
