import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalHide = process.env.HIDE_UI_SPONSOR_PROMO;

beforeEach(() => {
  delete process.env.HIDE_UI_SPONSOR_PROMO;
  vi.resetModules();
});

afterEach(() => {
  if (originalHide === undefined) delete process.env.HIDE_UI_SPONSOR_PROMO;
  else process.env.HIDE_UI_SPONSOR_PROMO = originalHide;
});

describe("isUiSponsorPromoEnabled", () => {
  it("is enabled by default", async () => {
    const { isUiSponsorPromoEnabled } = await import("@/lib/uiSponsorPromo.js");
    expect(isUiSponsorPromoEnabled()).toBe(true);
  });

  it("is disabled when HIDE_UI_SPONSOR_PROMO is truthy", async () => {
    for (const value of ["true", "1", "yes", "on"]) {
      process.env.HIDE_UI_SPONSOR_PROMO = value;
      vi.resetModules();
      const { isUiSponsorPromoEnabled } = await import("@/lib/uiSponsorPromo.js");
      expect(isUiSponsorPromoEnabled()).toBe(false);
    }
  });

  it("stays enabled for false-like or unset values", async () => {
    for (const value of [undefined, "", "false", "0", "no"]) {
      if (value === undefined) delete process.env.HIDE_UI_SPONSOR_PROMO;
      else process.env.HIDE_UI_SPONSOR_PROMO = value;
      vi.resetModules();
      const { isUiSponsorPromoEnabled } = await import("@/lib/uiSponsorPromo.js");
      expect(isUiSponsorPromoEnabled()).toBe(true);
    }
  });
});
