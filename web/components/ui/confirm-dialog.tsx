"use client";

// Reemplazo nativo de window.confirm() / alert() con un diálogo Claude Design.
// Uso:
//   const confirm = useConfirm();
//   const ok = await confirm({ title: "¿Cerrar turno?", description: "...", variant: "danger" });
//   if (!ok) return;
//
// Requiere <ConfirmDialogProvider> montado una sola vez (en app/providers.tsx).

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

type Variant = "danger" | "default";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
};

type Resolver = (value: boolean) => void;

type ConfirmContextValue = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() requires <ConfirmDialogProvider> in the tree");
  }
  return ctx;
}

// Reemplazo de window.alert() — solo OK, sin Cancel.
type AlertOptions = Omit<ConfirmOptions, "cancelLabel" | "variant">;

export function useAlert(): (opts: AlertOptions) => Promise<void> {
  const confirm = useConfirm();
  return useCallback(
    (opts: AlertOptions) =>
      confirm({ ...opts, cancelLabel: "__hide__", confirmLabel: opts.confirmLabel ?? "Entendido" }).then(() => undefined),
    [confirm]
  );
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmContextValue>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  // Esc cierra como cancel; Enter confirma.
  useEffect(() => {
    if (!opts) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", handler);
    cancelButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [opts, close]);

  // Bloquea scroll del body mientras el modal está abierto.
  useEffect(() => {
    if (!opts) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [opts]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby={opts.description ? "confirm-desc" : undefined}
          className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-[env(safe-area-inset-bottom,0px)] sm:items-center sm:p-6"
        >
          <button
            type="button"
            aria-label="Cerrar diálogo"
            onClick={() => close(false)}
            className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm animate-in fade-in duration-150"
          />
          <div
            className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200 sm:slide-in-from-bottom-0"
          >
            <div className="px-6 pt-6 pb-2">
              <h2
                id="confirm-title"
                className="text-base font-semibold text-neutral-900"
              >
                {opts.title}
              </h2>
              {opts.description ? (
                <p
                  id="confirm-desc"
                  className="mt-2 text-sm leading-relaxed text-neutral-600"
                >
                  {opts.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row sm:justify-end">
              {opts.cancelLabel === "__hide__" ? null : (
                <Button
                  ref={cancelButtonRef}
                  variant="secondary"
                  onClick={() => close(false)}
                  className="sm:min-w-[96px]"
                >
                  {opts.cancelLabel ?? "Cancelar"}
                </Button>
              )}
              <Button
                variant={opts.variant === "danger" ? "danger" : "primary"}
                onClick={() => close(true)}
                className="sm:min-w-[96px]"
                autoFocus={opts.variant !== "danger"}
              >
                {opts.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
