import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENCODE_CLIENT_FALLBACK_VERSION } from "../../open-sse/config/opencodeClient.js";
import {
  getCachedOpencodeUserAgent,
  parseReleaseTagName,
  resetOpencodeClientVersionCache,
  warmOpencodeUserAgentCache,
} from "../../open-sse/utils/opencodeClientVersion.js";

describe("opencodeClientVersion", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetOpencodeClientVersionCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetOpencodeClientVersionCache();
  });

  it("parses GitHub release tag names", () => {
    expect(parseReleaseTagName("v1.18.31")).toBe("1.18.31");
    expect(parseReleaseTagName("1.20.0")).toBe("1.20.0");
    expect(parseReleaseTagName("bad")).toBeNull();
  });

  it("uses fallback UA before warm", () => {
    expect(getCachedOpencodeUserAgent()).toBe(`opencode/${OPENCODE_CLIENT_FALLBACK_VERSION}`);
  });

  it("caches successful GitHub release lookup", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: "v2.0.1" }), { status: 200 }));

    const ua = await warmOpencodeUserAgentCache(true);
    expect(ua).toBe("opencode/2.0.1");
    expect(getCachedOpencodeUserAgent()).toBe("opencode/2.0.1");
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    await warmOpencodeUserAgentCache();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("falls back when GitHub lookup fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 }));

    const ua = await warmOpencodeUserAgentCache(true);
    expect(ua).toBe(`opencode/${OPENCODE_CLIENT_FALLBACK_VERSION}`);
  });
});
