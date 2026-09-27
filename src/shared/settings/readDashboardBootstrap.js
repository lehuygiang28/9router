const BOOTSTRAP_ID = "9router-dashboard-bootstrap";

export function readDashboardBootstrap() {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(BOOTSTRAP_ID);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

export const DASHBOARD_BOOTSTRAP_SCRIPT_ID = BOOTSTRAP_ID;
