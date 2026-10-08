function transform(body) {
  // Upstream rejects top-level "system" but accepts the same text as the first user message.
  return helpers.anthropicSystemToFirstUser(body);
}
