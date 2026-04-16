import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border border-neutral-200 bg-white shadow-sm", className)} {...props} />
  ),
);
Card.displayName = "Card";

export const CardHeader = (props: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={cn("flex flex-col gap-1 p-6", props.className)} />
);
export const CardTitle = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 {...props} className={cn("text-lg font-semibold text-neutral-900", props.className)} />
);
export const CardDescription = (props: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p {...props} className={cn("text-sm text-neutral-500", props.className)} />
);
export const CardContent = (props: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={cn("p-6 pt-0", props.className)} />
);
