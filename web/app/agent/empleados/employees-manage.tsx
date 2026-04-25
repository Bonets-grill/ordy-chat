"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

type Employee = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export function EmployeesManage({ initialEmployees }: { initialEmployees: Employee[] }) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function refresh() {
    router.refresh();
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d: { employees?: Employee[] }) => {
        if (d.employees) setEmployees(d.employees);
      })
      .catch(() => {});
  }

  async function createEmployee(form: { name: string; pin: string; role: "waiter" | "manager" }) {
    setError(null);
    if (!/^\d{4,6}$/.test(form.pin)) {
      setError("PIN debe ser 4-6 dígitos");
      return;
    }
    if (form.name.trim().length < 1) {
      setError("Nombre requerido");
      return;
    }
    start(async () => {
      const r = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(d.error ?? `Error ${r.status}`);
        return;
      }
      setAdding(false);
      refresh();
    });
  }

  async function patchEmployee(id: string, body: Partial<{ name: string; pin: string; role: "waiter" | "manager"; active: boolean }>) {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Error ${r.status}`);
        return;
      }
      refresh();
    });
  }

  async function deleteEmployee(id: string, name: string) {
    if (!confirm(`¿Desactivar a ${name}? Su PIN dejará de funcionar.`)) return;
    start(async () => {
      const r = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      if (!r.ok) {
        setError(`Error ${r.status}`);
        return;
      }
      refresh();
    });
  }

  return (
    <div className="space-y-3">
      {employees.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-500">
          Aún no hay empleados. Añade el primero abajo.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {employees.map((e) => (
            <EmployeeRow
              key={e.id}
              employee={e}
              onPatch={patchEmployee}
              onDelete={deleteEmployee}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <NewEmployeeForm
          pending={pending}
          onCancel={() => setAdding(false)}
          onCreate={createEmployee}
        />
      ) : (
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
          className="inline-flex items-center gap-2"
        >
          <UserPlus size={16} />
          Añadir empleado
        </Button>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function EmployeeRow({
  employee,
  onPatch,
  onDelete,
}: {
  employee: Employee;
  onPatch: (id: string, body: Partial<{ name: string; pin: string; role: "waiter" | "manager"; active: boolean }>) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(employee.name);
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"waiter" | "manager">(
    employee.role === "manager" ? "manager" : "waiter",
  );
  const lastLogin = employee.lastLoginAt
    ? new Date(employee.lastLoginAt).toLocaleString("es-ES")
    : "nunca";

  function save() {
    const body: Partial<{ name: string; pin: string; role: "waiter" | "manager" }> = {};
    if (name !== employee.name) body.name = name;
    if (pin) body.pin = pin;
    if (role !== employee.role) body.role = role;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    onPatch(employee.id, body);
    setEditing(false);
    setPin("");
  }

  if (editing) {
    return (
      <li className="space-y-2 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="PIN nuevo (déjalo vacío para no cambiarlo)"
          inputMode="numeric"
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 font-mono text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "waiter" | "manager")}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          <option value="waiter">Mesero</option>
          <option value="manager">Manager</option>
        </select>
        <div className="flex gap-2">
          <Button type="button" variant="primary" onClick={save}>Guardar</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(employee.name);
              setPin("");
              setRole(employee.role === "manager" ? "manager" : "waiter");
            }}
          >
            Cancelar
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-900">{employee.name}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              employee.role === "manager"
                ? "bg-neutral-900 text-white"
                : "bg-neutral-200 text-neutral-700"
            }`}
          >
            {employee.role === "manager" ? "Manager" : "Mesero"}
          </span>
          {!employee.active ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
              Inactivo
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">Último login: {lastLogin}</div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100"
          aria-label="Editar"
        >
          <Pencil size={14} />
        </button>
        {employee.active ? (
          <button
            type="button"
            onClick={() => onDelete(employee.id, employee.name)}
            className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
            aria-label="Desactivar"
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onPatch(employee.id, { active: true })}
          >
            Activar
          </Button>
        )}
      </div>
    </li>
  );
}

function NewEmployeeForm({
  pending,
  onCancel,
  onCreate,
}: {
  pending: boolean;
  onCancel: () => void;
  onCreate: (form: { name: string; pin: string; role: "waiter" | "manager" }) => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"waiter" | "manager">("waiter");
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del empleado"
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      />
      <input
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="PIN (4-6 dígitos)"
        inputMode="numeric"
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 font-mono text-sm"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "waiter" | "manager")}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      >
        <option value="waiter">Mesero</option>
        <option value="manager">Manager</option>
      </select>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() => onCreate({ name, pin, role })}
        >
          {pending ? "Creando…" : "Crear"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
