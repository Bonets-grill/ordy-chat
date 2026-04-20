// web/app/dashboard/playground/chips.ts
// Chips predefinidos por nicho. El tenant los ve como botones en el
// playground para probar situaciones típicas sin escribir.

export type Chip = {
  id: string;
  label: string;
  text: string;
  category: "saludo" | "horarios" | "reserva" | "menu" | "precio" | "pago" | "escalada";
};

const UNIVERSAL: Chip[] = [
  { id: "hola", label: "Hola", text: "Hola", category: "saludo" },
  { id: "horario", label: "¿Qué horario tenéis?", text: "¿A qué hora abrís hoy?", category: "horarios" },
  { id: "escalada", label: "Quiero hablar con una persona", text: "Necesito hablar con una persona real, por favor", category: "escalada" },
  { id: "cuanto", label: "¿Cuánto cuesta?", text: "¿Cuánto cuesta?", category: "precio" },
];

const RESTAURANTE: Chip[] = [
  { id: "reserva-4", label: "Reservar mesa", text: "Quiero reservar una mesa para 4 personas mañana a las 21:00", category: "reserva" },
  { id: "sin-gluten", label: "Sin gluten", text: "¿Tenéis opciones sin gluten?", category: "menu" },
  { id: "pedido", label: "Hacer pedido", text: "Quiero hacer un pedido para llevar", category: "menu" },
  { id: "menu-dia", label: "Menú del día", text: "¿Qué hay de menú del día?", category: "menu" },
  { id: "alergia", label: "Alergia frutos secos", text: "Tengo alergia a los frutos secos. ¿Qué puedo comer?", category: "menu" },
  { id: "cancelar", label: "Cancelar reserva", text: "Quiero cancelar la reserva que tengo", category: "escalada" },
  { id: "pago-bizum", label: "Pago con Bizum", text: "¿Puedo pagar con Bizum?", category: "pago" },
];

const CLINICA: Chip[] = [
  { id: "pedir-cita", label: "Pedir cita", text: "Quiero pedir cita para mañana por la tarde", category: "reserva" },
  { id: "cambiar-cita", label: "Cambiar cita", text: "Necesito cambiar la cita que tengo", category: "escalada" },
  { id: "urgencia", label: "Urgencia", text: "Tengo una urgencia, ¿pueden atenderme hoy?", category: "escalada" },
  { id: "precio-consulta", label: "Precio consulta", text: "¿Cuánto cuesta la primera consulta?", category: "precio" },
];

const HOTEL: Chip[] = [
  { id: "reservar-hab", label: "Reservar habitación", text: "Quiero reservar una habitación doble para el fin de semana", category: "reserva" },
  { id: "check-in", label: "¿Hora de check-in?", text: "¿A qué hora puedo hacer check-in?", category: "horarios" },
  { id: "parking", label: "¿Parking?", text: "¿Tenéis parking?", category: "menu" },
];

const SERVICIOS: Chip[] = [
  { id: "presupuesto", label: "Presupuesto", text: "Necesito un presupuesto", category: "precio" },
  { id: "cita-consulta", label: "Cita de consulta", text: "Quiero agendar una consulta", category: "reserva" },
];

function detectarNichoCliente(description: string, businessName: string): string {
  const s = `${businessName} ${description}`.toLowerCase();
  if (/restaurant|bar\b|caf|bodega|men[úu]|pizza|sushi|tapa|hamburgues|bistro|paella|grill|parrill|asador|steakhouse|churrasc|guachinche|tasca|burger/.test(s))
    return "restaurante";
  if (/cl[íi]nica|m[eé]dic|dentist|ortodon|nutrici|fisioterap|doctor|veterinar/.test(s)) return "clinica";
  if (/hotel|hostal|alojamiento|habitaci|hospedaje|posada|check[- ]in/.test(s)) return "hotel";
  return "servicios";
}

export function chipsForTenant({
  businessName,
  description,
}: {
  businessName: string;
  description: string;
}): Chip[] {
  const nicho = detectarNichoCliente(description, businessName);
  const specific =
    nicho === "restaurante"
      ? RESTAURANTE
      : nicho === "clinica"
      ? CLINICA
      : nicho === "hotel"
      ? HOTEL
      : SERVICIOS;
  return [...UNIVERSAL, ...specific];
}
