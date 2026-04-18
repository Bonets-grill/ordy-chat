"use client";

// web/app/admin/validator/filters.tsx — Filtros de la lista validator runs.
// Client component: actualiza searchParams on change.

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ValidatorRunStatus } from "@/lib/admin/validator-queries";

const STATUS_OPTIONS: Array<{ value: ""; label: string } | { value: ValidatorRunStatus; label: string }> = [
  { value: "", label: "Todos" },
  { value: "running", label: "running" },
  { value: "pass", label: "pass" },
  { value: "review", label: "review" },
  { value: "fail", label: "fail" },
  { value: "error", label: "error" },
];

const SINCE_OPTIONS: Array<{ value: 24 | 168 | 720; label: string }> = [
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
];

export function Filters({
  defaultSince,
  defaultStatus,
  defaultTenant,
}: {
  defaultSince: 24 | 168 | 720;
  defaultStatus: ValidatorRunStatus | undefined;
  defaultTenant: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  function update(partial: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    start(() => router.replace(`/admin/validator?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
      <div>
        <Label htmlFor="status">Estado</Label>
        <select
          id="status"
          defaultValue={defaultStatus ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="since">Ventana</Label>
        <select
          id="since"
          defaultValue={String(defaultSince)}
          onChange={(e) => update({ since: e.target.value })}
          className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[12rem]">
        <Label htmlFor="tenant">Tenant (slug o nombre)</Label>
        <Input
          id="tenant"
          defaultValue={defaultTenant}
          placeholder="taberna-lope…"
          onBlur={(e) => update({ tenant: e.currentTarget.value.trim() || undefined })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              update({ tenant: e.currentTarget.value.trim() || undefined });
            }
          }}
        />
      </div>

      {pending && <span className="text-xs text-neutral-500">actualizando…</span>}
    </div>
  );
}
