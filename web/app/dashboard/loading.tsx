// web/app/dashboard/loading.tsx — Sprint 5 F5.5 skeleton.
// Renderizado por Next.js mientras el RSC del dashboard carga.

import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-surface-subtle">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </main>
    </div>
  );
}
