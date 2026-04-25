// web/components/ui/skeleton.tsx — Sprint 5 F5.5.
// Skeleton base con shimmer via keyframes CSS.

import { cn } from "@/lib/utils";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-black/5",
        className,
      )}
      {...rest}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl bg-surface-card p-6 shadow-ringSubtle space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 border-b border-black/5 last:border-0">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}
