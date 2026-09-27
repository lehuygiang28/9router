import { DashboardLayout } from "@/shared/components";
import { isUiSponsorPromoEnabled } from "@/lib/uiSponsorPromo.js";
import { DASHBOARD_BOOTSTRAP_SCRIPT_ID } from "@/shared/settings/readDashboardBootstrap";

export default function DashboardRootLayout({ children }) {
  const bootstrap = JSON.stringify({
    uiSponsorPromoEnabled: isUiSponsorPromoEnabled(),
  });

  return (
    <>
      <script
        id={DASHBOARD_BOOTSTRAP_SCRIPT_ID}
        type="application/json"
        dangerouslySetInnerHTML={{ __html: bootstrap }}
      />
      <DashboardLayout>{children}</DashboardLayout>
    </>
  );
}

