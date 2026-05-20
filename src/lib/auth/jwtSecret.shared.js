/**
 * Stable dev fallback so middleware (Edge runtime, no fs) and the login route
 * (Node runtime) end up with the same key when JWT_SECRET is unset.
 * Override via JWT_SECRET in production / wrangler.jsonc / .env.
 */
export const DEV_JWT_SECRET =
  "9router-dev-jwt-secret-set-JWT_SECRET-in-production";

/** Edge-safe: only consults process.env — no fs, no Node builtins. */
export function getSharedJwtSecretString() {
  if (typeof process !== "undefined" && process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  return DEV_JWT_SECRET;
}

export function getSharedJwtSecretKey() {
  return new TextEncoder().encode(getSharedJwtSecretString());
}
