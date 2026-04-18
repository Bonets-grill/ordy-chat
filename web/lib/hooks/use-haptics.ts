// web/lib/hooks/use-haptics.ts — wrapper de @capacitor/haptics.
// Sprint 5 F5.2.
//
// Uso:
//   const h = useHaptics();
//   <Button onClick={() => { h.impact(); onClick(); }}>…</Button>
//
// En web sin Capacitor: no-op. En PWA iOS: usa Vibration API si disponible.
// En WebView Capacitor: delega al plugin nativo.

"use client";

import { useMemo } from "react";

type Impact = "light" | "medium" | "heavy";
type Notify = "success" | "warning" | "error";

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Haptics?: {
        impact?: (opts: { style: string }) => Promise<void>;
        notification?: (opts: { type: string }) => Promise<void>;
        selectionStart?: () => Promise<void>;
        selectionChanged?: () => Promise<void>;
        selectionEnd?: () => Promise<void>;
      };
    };
  };
};

const IMPACT_MAP: Record<Impact, string> = {
  light: "LIGHT",
  medium: "MEDIUM",
  heavy: "HEAVY",
};

const NOTIFY_MAP: Record<Notify, string> = {
  success: "SUCCESS",
  warning: "WARNING",
  error: "ERROR",
};

// Patterns ms para fallback Vibration API.
const IMPACT_VIBR: Record<Impact, number | number[]> = {
  light: 10,
  medium: 18,
  heavy: 30,
};
const NOTIFY_VIBR: Record<Notify, number[]> = {
  success: [12, 50, 12],
  warning: [20, 60, 20],
  error: [30, 60, 30, 60, 30],
};

export function useHaptics() {
  return useMemo(() => {
    function getCap() {
      if (typeof window === "undefined") return null;
      const w = window as CapacitorWindow;
      if (!w.Capacitor?.isNativePlatform?.()) return null;
      return w.Capacitor.Plugins?.Haptics ?? null;
    }

    function webVibrate(pattern: number | number[]) {
      if (typeof navigator === "undefined") return;
      const n = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      n.vibrate?.(pattern);
    }

    return {
      impact(style: Impact = "medium") {
        const h = getCap();
        if (h?.impact) {
          h.impact({ style: IMPACT_MAP[style] }).catch(() => {});
          return;
        }
        webVibrate(IMPACT_VIBR[style]);
      },
      notification(type: Notify = "success") {
        const h = getCap();
        if (h?.notification) {
          h.notification({ type: NOTIFY_MAP[type] }).catch(() => {});
          return;
        }
        webVibrate(NOTIFY_VIBR[type]);
      },
      selectionStart() {
        getCap()?.selectionStart?.().catch(() => {});
      },
      selectionChanged() {
        const h = getCap();
        if (h?.selectionChanged) {
          h.selectionChanged().catch(() => {});
          return;
        }
        webVibrate(5);
      },
      selectionEnd() {
        getCap()?.selectionEnd?.().catch(() => {});
      },
    };
  }, []);
}
