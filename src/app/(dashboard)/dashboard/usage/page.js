"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl, InlineLoadingBar } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import UsageDateRangePicker from "./components/UsageDateRangePicker";
import { defaultCustomRangeDates } from "./utils/usagePeriodQuery";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");
  const [customRange, setCustomRange] = useState(() => defaultCustomRangeDates());
  const [statsBusy, setStatsBusy] = useState(true);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  const handlePeriodChange = useCallback((next) => {
    setPeriod(next);
    if (next === "custom" && (!customRange.startDate || !customRange.endDate)) {
      setCustomRange(defaultCustomRangeDates());
    }
  }, [customRange.startDate, customRange.endDate]);

  const handleCustomRangeChange = useCallback((range) => {
    setCustomRange(range);
    setPeriod("custom");
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            className="w-full sm:w-auto"
          />
          {activeTab === "overview" && (
            <div className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-[20rem]">
              <SegmentedControl
                options={PERIODS}
                value={period}
                onChange={handlePeriodChange}
                size="sm"
                className="w-full sm:w-auto"
                disabled={statsBusy}
              />
              {statsBusy && <InlineLoadingBar className="w-full" />}
            </div>
          )}
        </div>
        {activeTab === "overview" && period === "custom" && (
          <UsageDateRangePicker
            startDate={customRange.startDate}
            endDate={customRange.endDate}
            onChange={handleCustomRangeChange}
            disabled={statsBusy}
            className="sm:justify-end"
          />
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats
            period={period}
            setPeriod={handlePeriodChange}
            customRange={period === "custom" ? customRange : null}
            hidePeriodSelector
            onBusyChange={setStatsBusy}
          />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
