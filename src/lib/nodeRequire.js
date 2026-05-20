/**
 * Node/Bun CJS resolver for server-side code only.
 * Do NOT import from middleware.js or other Edge-runtime bundles.
 */
import { createRequire } from "node:module";

export const nativeRequire = createRequire(import.meta.url);
