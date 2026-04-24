// web/lib/payment-methods.ts
//
// Fuente única de verdad para los métodos de pago por pedido (mig 039).
// Cambiar aquí requiere migración DB (el CHECK constraint está en SQL).
//
// Semántica en el cuadre de caja (endpoint /api/shifts/[id]/close):
//   'cash'        → entra en "efectivo esperado"
//   'card'        → NO entra en caja (TPV/Stripe ya liquidan por su cuenta)
//   'transfer'    → NO entra (Bizum/transferencia)
//   'other'       → NO entra (cheque-gourmet, vale, etc.)
//   null/undefined → tratado como 'cash' por retro-compat (pedidos pre-mig 039).

export const ORDER_PAYMENT_METHODS = ["cash", "card", "transfer", "other"] as const;

export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const ORDER_PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia/Bizum",
  other: "Otro",
};

/** true si este método debe sumarse al "efectivo esperado" del cierre de turno. */
export function countsAsCash(method: OrderPaymentMethod | null | undefined): boolean {
  // NULL = pedido viejo pre-mig 039 → retro-compat: se cuenta como cash.
  return method == null || method === "cash";
}
