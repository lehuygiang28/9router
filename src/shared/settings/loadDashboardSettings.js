import useSettingsStore from "@/store/settingsStore";

let loadPromise;

/** Single shared /api/settings fetch for dashboard shell (Suspense via React `use`). */
export function loadDashboardSettings() {
  if (!loadPromise) {
    loadPromise = useSettingsStore
      .getState()
      .fetchSettings()
      .then((data) => data ?? {});
  }
  return loadPromise;
}
