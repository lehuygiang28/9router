function transform(body) {
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
}
