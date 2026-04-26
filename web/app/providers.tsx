"use client";

import { SessionProvider } from "next-auth/react";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
    </SessionProvider>
  );
}
