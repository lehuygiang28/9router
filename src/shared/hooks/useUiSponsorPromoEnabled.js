import useSettingsStore from "@/store/settingsStore";

export function useUiSponsorPromoEnabled() {
  return useSettingsStore((state) => {
    const value = state.settings?.uiSponsorPromoEnabled;
    return typeof value === "boolean" ? value : true;
  });
}
