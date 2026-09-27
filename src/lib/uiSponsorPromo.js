function isTruthyEnv(value) {
  if (value === undefined || value === null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Donate modal, 9Remote, and 9English sidebar/header promo. Default on; set HIDE_UI_SPONSOR_PROMO=true to hide. */
export function isUiSponsorPromoEnabled() {
  return !isTruthyEnv(process.env.HIDE_UI_SPONSOR_PROMO);
}
