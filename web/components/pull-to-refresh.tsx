"use client";

// web/components/pull-to-refresh.tsx — Sprint 5 F5.4.
//
// Componente sin dep externa. Detecta touch-drag downward cuando scrollTop=0,
// muestra indicador circular creciente, al soltar dispara router.refresh()
// (o callback custom) con haptics de feedback.
//
// Uso:
//   <PullToRefresh>
//     {children}
//   </PullToRefresh>

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHaptics } from "@/lib/hooks/use-haptics";

const THRESHOLD_PX = 70;
const MAX_PULL_PX = 120;

export function PullToRefresh({
  children,
  onRefresh,
}: {
  children: React.ReactNode;
  onRefresh?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const haptics = useHaptics();
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const reachedThresholdRef = useRef(false);

  const triggerRefresh = useCallback(async () => {
    setRefreshing(true);
    haptics.notification("success");
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        router.refresh();
        // dar tiempo a RSC re-render
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setRefreshing(false);
      setPullY(0);
      reachedThresholdRef.current = false;
    }
  }, [haptics, onRefresh, router]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      if (window.scrollY > 0) return; // solo cuando estamos arriba del todo
      startYRef.current = e.touches[0]?.clientY ?? null;
    }

    function onTouchMove(e: TouchEvent) {
      if (refreshing) return;
      if (startYRef.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startYRef.current;
      if (dy <= 0) {
        setPullY(0);
        return;
      }
      // damping: drag feels resistive
      const damped = Math.min(MAX_PULL_PX, dy * 0.55);
      setPullY(damped);
      if (!reachedThresholdRef.current && damped >= THRESHOLD_PX) {
        reachedThresholdRef.current = true;
        haptics.impact("light");
      }
    }

    function onTouchEnd() {
      if (refreshing) return;
      if (startYRef.current === null) return;
      const should = reachedThresholdRef.current;
      startYRef.current = null;
      if (should) {
        triggerRefresh();
      } else {
        setPullY(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [haptics, refreshing, triggerRefresh]);

  const progress = Math.min(1, pullY / THRESHOLD_PX);
  const rotation = progress * 360;
  const visible = pullY > 4 || refreshing;

  return (
    <div ref={containerRef} className="relative">
      {/* Indicador circular arriba */}
      {visible && (
        <div
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 flex items-center justify-center"
          style={{
            transform: `translate(-50%, ${refreshing ? 24 : pullY * 0.4}px)`,
            opacity: refreshing ? 1 : progress,
            transition: refreshing ? "none" : "opacity 120ms ease",
          }}
        >
          <div
            className={`h-9 w-9 rounded-full border-2 ${
              refreshing
                ? "border-neutral-900 border-t-transparent animate-spin"
                : "border-neutral-300 border-t-neutral-900"
            }`}
            style={{
              transform: refreshing ? undefined : `rotate(${rotation}deg)`,
              transition: refreshing ? "none" : "transform 60ms linear",
            }}
          />
        </div>
      )}
      <div
        style={{
          transform: `translateY(${refreshing ? 40 : pullY}px)`,
          transition: refreshing || pullY === 0 ? "transform 200ms ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
