// web/components/ui/badge.tsx — Badge "Claude Design".
//
// Tonos refinados (claros + texto oscuro), no muy saturados. Pill shape
// (rounded-full). 11.5px font, tracking ligeramente más abierto que el
// body. Default tone: muted.

import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "muted"
  | "new"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "wa"
  | "violet";

const TONE: Record<BadgeTone, string> = {
  muted:   "bg-black/5 text-ink-700",
  new:     "bg-ink-900 text-white",
  success: "bg-success-50 text-success-700",
  warn:    "bg-warn-50 text-warn-800",
  danger:  "bg-danger-50 text-danger-700",
  info:    "bg-info-50 text-info-700",
  wa:      "bg-wa-50 text-wa-600",
  violet:  "bg-violet-100 text-violet-700",
};

export function Badge({
  tone = "muted",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-5 tracking-tight",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
