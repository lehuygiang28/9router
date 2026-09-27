import { isTruthyEnv } from "@/lib/envFlags.js";

/** Donate modal, 9Remote, and 9English sidebar/header promo. Default on; set HIDE_UI_SPONSOR_PROMO=true to hide. */
export function isUiSponsorPromoEnabled() {
  return !isTruthyEnv(process.env.HIDE_UI_SPONSOR_PROMO);
}
