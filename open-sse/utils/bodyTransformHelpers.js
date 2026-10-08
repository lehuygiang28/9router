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

/**
 * Move Anthropic Messages API `system` into a leading `user` message (block content).
 * @param {object} body
 * @param {{ removeSystem?: boolean }} [opts]
 */
export function anthropicSystemToFirstUser(body, opts = {}) {
  if (!body || typeof body !== "object") return body;
  const removeSystem = opts.removeSystem !== false;
  if (body.system == null || body.system === "") return body;

  const blocks = systemToBlocks(body.system);
  if (!blocks.length) return body;

  const prefix = { role: "user", content: blocks };
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const out = { ...body, messages: [prefix, ...messages] };
  if (removeSystem) delete out.system;
  return out;
}

export function createBodyTransformHelpers() {
  return {
    toContentBlocks,
    systemToBlocks,
    anthropicSystemToFirstUser,
  };
}
