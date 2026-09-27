import { DashboardLayout } from "@/shared/components";
import { isUiSponsorPromoEnabled } from "@/lib/uiSponsorPromo.js";

export const dynamic = "force-dynamic";

export default function DashboardRootLayout({ children }) {
  const uiSponsorPromoEnabled = isUiSponsorPromoEnabled();

  return (
    <DashboardLayout uiSponsorPromoEnabled={uiSponsorPromoEnabled}>
      {children}
    </DashboardLayout>
  );
}

