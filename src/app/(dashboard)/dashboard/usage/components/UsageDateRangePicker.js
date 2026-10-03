"use client";

import { cn } from "@/shared/utils/cn";
import { formatUsageDateInput } from "../utils/usagePeriodQuery";

export default function UsageDateRangePicker({
  startDate,
  endDate,
  onChange,
  disabled = false,
  className,
}) {
  const today = formatUsageDateInput(new Date());

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-text-muted">From</span>
        <input
          type="date"
          value={startDate}
          max={endDate || today}
          disabled={disabled}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm text-text-main disabled:opacity-60"
          style={{ colorScheme: "auto" }}
        />
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-text-muted">To</span>
        <input
          type="date"
          value={endDate}
          min={startDate}
          max={today}
          disabled={disabled}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm text-text-main disabled:opacity-60"
          style={{ colorScheme: "auto" }}
        />
      </label>
    </div>
  );
}
