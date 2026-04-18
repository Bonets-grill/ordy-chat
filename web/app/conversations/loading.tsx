// web/app/conversations/loading.tsx — Sprint 5 F5.5.

import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLoading() {
  return (
    <div className="min-h-screen bg-surface-subtle">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}
