"use client";

import { cn } from "@/shared/utils/cn";

// Spinner loading
export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-brand-500",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
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

/** Dimmed overlay while refreshing in-place data */
export function SectionBusyOverlay({ label = "Updating…", className }) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-bg/55 backdrop-blur-[1px]",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 shadow-sm">
        <Spinner size="sm" />
        <span className="text-sm text-text-muted">{label}</span>
      </div>
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
