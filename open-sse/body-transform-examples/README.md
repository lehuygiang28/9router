# Body transform example scripts

Runnable JavaScript for **Custom routing → Advanced body transform**. Each `.js` file is copied as-is into the editor (must define `function transform(body) { … return body; }`).

| Limit | Value |
|--------|--------|
| Language | JavaScript (strict mode in VM) |
| Max script size | 16 384 characters |
| Runtime timeout | 50 ms per request |
| Globals | `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `helpers` |

**Not allowed:** `require`, `import`, `process`, `eval`, `Function(…)`, `fetch`, `globalThis`, `child_process`.

On error or timeout the upstream body is left unchanged (fail-open).

**Threat model:** Scripts are privileged code on your gateway. `node:vm` plus lint rules reduce accidents but are **not** a strong isolation boundary against a motivated author. Only users who can edit provider overrides should enable transforms. Helpers are defined inside the VM preamble (not host function references).

Catalog is listed in `examples.json`. Loaded by `open-sse/utils/providerBodyTransformExamples.server.js`.
