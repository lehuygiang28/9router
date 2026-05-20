/**
 * Detect a bcrypt modular-crypt hash ($2a$ / $2b$ / $2y$).
 * Used to avoid calling bcrypt.compare on garbage values (can stall CPU on Workers).
 */
export function looksLikeBcryptHash(value) {
  return (
    typeof value === "string" &&
    /^\$2[aby]\$\d{2}\$[./0-9A-Za-z]{53}$/.test(value)
  );
}
