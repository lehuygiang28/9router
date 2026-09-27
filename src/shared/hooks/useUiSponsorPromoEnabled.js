import useSettingsStore from "@/store/settingsStore";

export function useUiSponsorPromoEnabled() {
  return useSettingsStore((state) => state.settings?.uiSponsorPromoEnabled ?? true);
}
