/**
 * Helpers exposed to custom provider body-transform scripts (VM sandbox).
 */

function toContentBlocks(content) {
  if (content == null) return [{ type: "text", text: "" }];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return { type: "text", text: item };
      if (item && typeof item === "object") {
        const type = item.type || "text";
        if (type === "text" && item.text != null) {
          const { text, ...rest } = item;
          return { type: "text", text: String(text), ...rest };
        }
        return { ...item };
      }
      return { type: "text", text: String(item) };
    });
  }
  if (typeof content === "object") return [content];
  return [{ type: "text", text: String(content) }];
}

function systemToBlocks(system) {
  if (system == null) return [];
  if (typeof system === "string") return [{ type: "text", text: system }];
  if (Array.isArray(system)) {
    return system.map((item) => {
      if (typeof item === "string") return { type: "text", text: item };
      if (item && typeof item === "object") {
        const type = item.type || "text";
        if (type === "text") {
          const { text, ...rest } = item;
          return { type: "text", text: text != null ? String(text) : "", ...rest };
        }
        return { ...item };
      }
      return { type: "text", text: String(item) };
    });
  }
  if (typeof system === "object" && system.text != null) {
    return [{ type: "text", text: String(system.text), ...system }];
  }
  return [{ type: "text", text: String(system) }];
}

function stripCacheFromBlocks(blocks) {
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const { cache_control, ...rest } = block;
    return rest;
  });
}

/** Drop ttl; keep type (default ephemeral). Safe for gateways that reject ttl on user blocks. */
export function normalizeBlockCacheControl(block) {
  if (!block || typeof block !== "object" || !block.cache_control) return block;
  const cc = block.cache_control;
  if (typeof cc !== "object" || cc === null) {
    const { cache_control, ...rest } = block;
    return rest;
  }
  const { ttl, ...rest } = cc;
  const next = { ...rest };
  if (!next.type) next.type = "ephemeral";
  return { ...block, cache_control: next };
}

function userMessagesHaveCacheControl(body) {
  for (const msg of body.messages || []) {
    if (msg?.role !== "user") continue;
    for (const block of toContentBlocks(msg.content)) {
      if (block?.cache_control) return true;
    }
  }
  return false;
}

function preparePromotedSystemBlocks(blocks, body, opts) {
  if (opts.stripCacheControl === true) return stripCacheFromBlocks(blocks);
  const userHasCache = userMessagesHaveCacheControl(body);
  return blocks.map((block, i) => {
    if (!block || typeof block !== "object") return block;
    if (block.cache_control) return normalizeBlockCacheControl(block);
    // When the client already sent cache markers on user turns, mirror a default
    // ephemeral breakpoint on the last promoted system text block (no ttl).
    if (userHasCache && i === blocks.length - 1 && (block.type === "text" || block.text != null)) {
      return { ...block, cache_control: { type: "ephemeral" } };
    }
    return block;
  });
}

/**
 * Move Anthropic Messages API `system` into a leading `user` message (block content).
 * @param {object} body
 * @param {{ removeSystem?: boolean, stripCacheControl?: boolean }} [opts]
 * stripCacheControl defaults false — keeps cache_control, drops ttl only. User-turn
 * cache_control is always preserved. Set stripCacheControl true to remove all cache on promoted blocks.
 */
export function anthropicSystemToFirstUser(body, opts = {}) {
  if (!body || typeof body !== "object") return body;
  const removeSystem = opts.removeSystem !== false;
  if (body.system == null || body.system === "") return body;

  let blocks = systemToBlocks(body.system);
  if (!blocks.length) return body;
  blocks = preparePromotedSystemBlocks(blocks, body, opts);

  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const first = messages[0];
  let nextMessages;
  if (first?.role === "user") {
    nextMessages = [{ ...first, content: [...blocks, ...toContentBlocks(first.content)] }, ...messages.slice(1)];
  } else {
    nextMessages = [{ role: "user", content: blocks }, ...messages];
  }
  const out = { ...body, messages: nextMessages };
  if (removeSystem) delete out.system;
  return out;
}

export function createBodyTransformHelpers() {
  return {
    toContentBlocks,
    systemToBlocks,
    normalizeBlockCacheControl,
    anthropicSystemToFirstUser,
  };
}
