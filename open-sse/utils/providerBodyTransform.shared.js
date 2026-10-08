export const MAX_BODY_TRANSFORM_SCRIPT_CHARS = 16_384;

/** @typedef {{ id: string, label: string, description: string, script: string, sample: object, afterHint?: string }} BodyTransformExample */

export const ANTHROPIC_SYSTEM_TO_USER_SCRIPT = `function transform(body) {
  // Upstream rejects top-level "system" but accepts the same text as the first user message.
  return helpers.anthropicSystemToFirstUser(body);
}`;

/** Failing-style body: system + user messages (Anthropic Messages API). */
export const ANTHROPIC_SYSTEM_TO_USER_SAMPLE = {
  model: "claude-haiku-5-5",
  max_tokens: 2048,
  stream: false,
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "hi" }],
    },
  ],
  system: [
    {
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
};

export const ANTHROPIC_SYSTEM_STRIP_TTL_SCRIPT = `function transform(body) {
  body = helpers.anthropicSystemToFirstUser(body);
  for (const msg of body.messages || []) {
    const blocks = msg.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block && block.cache_control && "ttl" in block.cache_control) {
        const { ttl, ...rest } = block.cache_control;
        block.cache_control = Object.keys(rest).length ? rest : undefined;
        if (!block.cache_control) delete block.cache_control;
      }
    }
  }
  return body;
}`;

/** @type {BodyTransformExample[]} */
export const BODY_TRANSFORM_EXAMPLES = [
  {
    id: "anthropic-system-to-user",
    label: "Anthropic: system → first user message",
    description:
      "Use when requests with top-level system (and optional cache_control on system blocks) fail upstream, "
      + "but the same prompt works as the first user message. Matches the Claude Code CLI system prompt pattern.",
    script: ANTHROPIC_SYSTEM_TO_USER_SCRIPT,
    sample: ANTHROPIC_SYSTEM_TO_USER_SAMPLE,
    afterHint:
      "Removes system. Inserts one user message at the start whose content blocks are copied from system; "
      + "your existing user messages follow (e.g. \"hi\" becomes the second user turn).",
  },
  {
    id: "anthropic-system-to-user-strip-ttl",
    label: "Anthropic: system → user + remove cache_control.ttl",
    description:
      "Same as above, then strips ttl from cache_control on message blocks (some gateways only accept type: ephemeral).",
    script: ANTHROPIC_SYSTEM_STRIP_TTL_SCRIPT,
    sample: ANTHROPIC_SYSTEM_TO_USER_SAMPLE,
    afterHint: "Leading user message keeps cache_control without ttl when present.",
  },
];

/** @deprecated use ANTHROPIC_SYSTEM_TO_USER_SCRIPT */
export const DEFAULT_BODY_TRANSFORM_EXAMPLE = ANTHROPIC_SYSTEM_TO_USER_SCRIPT;

/** @deprecated use ANTHROPIC_SYSTEM_TO_USER_SAMPLE */
export const DEFAULT_BODY_TRANSFORM_SAMPLE = ANTHROPIC_SYSTEM_TO_USER_SAMPLE;

export function getBodyTransformExample(id) {
  return BODY_TRANSFORM_EXAMPLES.find((e) => e.id === id) || null;
}
