"use client";

import { cn } from "@/shared/utils/cn";

const SPINNER_SIZES = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-5 border-2",
  lg: "size-7 border-2",
  xl: "size-10 border-[3px]",
};

/** Ring spinner (no Material icon — reads cleaner in dense dashboards) */
export function Spinner({ size = "md", className, label }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-block shrink-0 rounded-full border-solid border-current border-r-transparent animate-spin text-primary/80",
          SPINNER_SIZES[size],
        )}
        role="status"
        aria-hidden={!label}
        aria-label={label || undefined}
      />
      {label ? <span className="text-sm text-text-muted">{label}</span> : null}
    </span>
  );
}

/** Thin indeterminate bar for toolbars / period selectors */
export function InlineLoadingBar({ className }) {
  return (
    <div
      className={cn("h-0.5 w-full overflow-hidden rounded-full bg-border/70", className)}
      aria-hidden="true"
    >
      <div className="h-full w-[38%] rounded-full bg-primary animate-usage-indeterminate" />
    </div>
  );
}

// Full page loading
export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg">
      <Spinner size="xl" />
      <p className="mt-4 text-text-muted">{message}</p>
    </div>
  );
}

// Skeleton loading
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

// Card skeleton
export function CardSkeleton() {
  return (
    <div className="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-[10px]" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/** Usage dashboard — overview metric cards */
export function UsageOverviewCardsSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-0 flex-col items-center gap-2 rounded-[14px] border border-border-subtle bg-surface px-3 py-4"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Usage dashboard — time-series chart area */
export function UsageChartSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border-subtle bg-surface p-3 sm:p-4">
      <Skeleton className="h-8 w-40 rounded-lg" />
      <Skeleton className="h-[220px] w-full rounded-lg" />
    </div>
  );
}

/** Usage dashboard — breakdown table */
export function UsageTableSkeleton({ rows = 5 }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border-subtle bg-surface">
      <div className="border-b border-border-subtle px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 flex-1 max-w-[200px]" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Light in-place refresh — top progress bar + veil (no floating pill + icon) */
export function SectionBusyOverlay({ label = "Updating…", className }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/10">
        <div className="h-full w-[38%] rounded-full bg-primary/90 animate-usage-indeterminate" />
      </div>
      <div className="absolute inset-0 bg-bg/25" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
