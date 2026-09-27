export function isTruthyEnv(value) {
  if (value === undefined || value === null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
