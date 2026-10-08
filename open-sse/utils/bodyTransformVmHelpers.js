/**
 * VM preamble source (bundler-safe: no fs read at module load).
 * Keep in sync with helper behavior in bodyTransformHelpers.js.
 */
export const BODY_TRANSFORM_VM_HELPERS_SRC = `function systemToBlocks(system) {
  if (system == null) return [];
  if (typeof system === "string") return [{ type: "text", text: system }];
  if (Array.isArray(system)) {
    return system.map((item) => {
      if (typeof item === "string") return { type: "text", text: item };
      if (item && typeof item === "object") {
        const type = item.type || "text";
        if (type === "text") {
          const text = item.text != null ? String(item.text) : "";
          const rest = Object.assign({}, item);
          delete rest.text;
          return Object.assign({ type: "text", text }, rest);
        }
        return Object.assign({}, item);
      }
      return { type: "text", text: String(item) };
    });
  }
  if (typeof system === "object" && system.text != null) {
    return [Object.assign({ type: "text", text: String(system.text) }, system)];
  }
  return [{ type: "text", text: String(system) }];
}

function stripCacheFromBlocks(blocks) {
  return blocks.map(function (block) {
    if (!block || typeof block !== "object") return block;
    var rest = Object.assign({}, block);
    delete rest.cache_control;
    return rest;
  });
}

function toContentBlocks(content) {
  if (content == null) return [{ type: "text", text: "" }];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.map(function (item) {
      if (typeof item === "string") return { type: "text", text: item };
      if (item && typeof item === "object") return Object.assign({}, item);
      return { type: "text", text: String(item) };
    });
  }
  return [{ type: "text", text: String(content) }];
}

function anthropicSystemToFirstUser(body, opts) {
  if (!body || typeof body !== "object") return body;
  opts = opts || {};
  var stripCacheControl = opts.stripCacheControl !== false;
  if (body.system == null || body.system === "") return body;
  var blocks = systemToBlocks(body.system);
  if (!blocks.length) return body;
  if (stripCacheControl) blocks = stripCacheFromBlocks(blocks);
  var messages = Array.isArray(body.messages) ? body.messages.slice() : [];
  var first = messages[0];
  var nextMessages;
  if (first && first.role === "user") {
    nextMessages = [Object.assign({}, first, { content: blocks.concat(toContentBlocks(first.content)) })].concat(messages.slice(1));
  } else {
    nextMessages = [{ role: "user", content: blocks }].concat(messages);
  }
  var out = Object.assign({}, body, { messages: nextMessages });
  delete out.system;
  return out;
}`;
