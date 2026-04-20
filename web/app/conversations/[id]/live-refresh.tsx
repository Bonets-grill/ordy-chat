"use client";

// Auto-refresh del thread cada 5s para que se vea "en vivo" al agente
// respondiendo. El server component se re-renderiza con los mensajes
// nuevos gracias a router.refresh() (force-dynamic ya activo en el layout).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ pollMs = 5000 }: { pollMs?: number }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setTick((t) => t + 1);
    }, pollMs);
    return () => clearInterval(id);
  }, [router, pollMs]);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
      title={`Auto-refresh cada ${pollMs / 1000}s · tick ${tick}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      En vivo
    </span>
  );
}
