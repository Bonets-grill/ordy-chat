import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "new" | "success" | "warn" | "muted";

const TONE: Record<Tone, string> = {
  new: "bg-neutral-900 text-white",
  success: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  muted: "bg-neutral-100 text-neutral-600",
};

export function Badge({ tone = "muted", className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)} {...rest}>
      {children}
    </span>
  );
}
