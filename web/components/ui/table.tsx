// web/components/ui/table.tsx — Table primitives "Claude Design".
//
// Wrappers ligeros sobre <table>. Header sticky opcional, hover row,
// dividers sutiles, número alineado a la derecha por defecto vía
// la clase utility `.num` (sólo aplicar a celdas numéricas).
//
// Uso típico:
//
//   <TableContainer>
//     <Table>
//       <THead>
//         <TR>
//           <TH>Fecha</TH>
//           <TH>Tenant</TH>
//           <TH align="right">Importe</TH>
//         </TR>
//       </THead>
//       <TBody>
//         {rows.map((r) => (
//           <TR key={r.id}>
//             <TD>{r.date}</TD>
//             <TD>{r.tenant}</TD>
//             <TD align="right" className="tabular-nums">{r.amount}</TD>
//           </TR>
//         ))}
//       </TBody>
//     </Table>
//   </TableContainer>

import * as React from "react";
import { cn } from "@/lib/utils";

export function TableContainer({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl bg-surface-card shadow-ringSubtle",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table({
  className,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full text-sm text-left text-ink-700", className)}
      {...rest}
    />
  );
}

export function THead({
  className,
  sticky,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "bg-surface-subtle/80 backdrop-blur text-[12px] font-medium uppercase tracking-wider2 text-ink-500",
        sticky && "sticky top-0 z-10",
        className,
      )}
      {...rest}
    />
  );
}

export function TBody({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("[&>tr]:border-t [&>tr]:border-black/5", className)}
      {...rest}
    />
  );
}

export function TR({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-black/[0.02]",
        className,
      )}
      {...rest}
    />
  );
}

type CellAlign = "left" | "center" | "right";
const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right tabular-nums",
};

export function TH({
  className,
  align = "left",
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-3 font-medium",
        ALIGN[align],
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  className,
  align = "left",
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle",
        ALIGN[align],
        className,
      )}
      {...rest}
    />
  );
}
