import useSettingsStore from "@/store/settingsStore";
import { readDashboardBootstrap } from "@/shared/settings/readDashboardBootstrap";

let loadPromise;

function applyBootstrapFallback() {
  const boot = readDashboardBootstrap();
  if (!boot) return null;
  useSettingsStore.setState({ settings: boot, lastFetched: Date.now() });
  return boot;
}

/** Single shared /api/settings fetch for dashboard shell (Suspense via React `use`). */
export function loadDashboardSettings() {
  if (!loadPromise) {
    loadPromise = useSettingsStore
      .getState()
      .fetchSettings()
      .then((data) => {
        if (data) return data;
        return applyBootstrapFallback() ?? {};
      })
      .catch(() => applyBootstrapFallback() ?? {});
  }
  return loadPromise;
}
