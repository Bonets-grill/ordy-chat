// Allowlist IANA timezone para ajustes del tenant.
//
// Foco España + UE + Latam más comunes. Si un cliente nuevo pide otra TZ,
// añadimos aquí. NO aceptar texto libre: se inyecta en SQL AT TIME ZONE y
// también se usa en isWithinSchedule (lib/schedule.ts).

export type TimezoneOption = {
  value: string;
  label: string;
  group: "España" | "Europa" | "América" | "Otros";
};

export const TIMEZONES: readonly TimezoneOption[] = [
  // España (las 2 únicas oficiales)
  { value: "Europe/Madrid", label: "Península y Baleares (GMT+1/+2)", group: "España" },
  { value: "Atlantic/Canary", label: "Canarias (GMT+0/+1)", group: "España" },

  // Europa común
  { value: "Europe/Lisbon", label: "Lisboa (GMT+0/+1)", group: "Europa" },
  { value: "Europe/Paris", label: "París (GMT+1/+2)", group: "Europa" },
  { value: "Europe/Berlin", label: "Berlín (GMT+1/+2)", group: "Europa" },
  { value: "Europe/Rome", label: "Roma (GMT+1/+2)", group: "Europa" },
  { value: "Europe/London", label: "Londres (GMT+0/+1)", group: "Europa" },
  { value: "Europe/Amsterdam", label: "Ámsterdam (GMT+1/+2)", group: "Europa" },

  // América Latina (clientes potenciales)
  { value: "America/Mexico_City", label: "Ciudad de México (GMT-6/-5)", group: "América" },
  { value: "America/Bogota", label: "Bogotá (GMT-5)", group: "América" },
  { value: "America/Lima", label: "Lima (GMT-5)", group: "América" },
  { value: "America/Santiago", label: "Santiago (GMT-4/-3)", group: "América" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (GMT-3)", group: "América" },
  { value: "America/Sao_Paulo", label: "São Paulo (GMT-3/-2)", group: "América" },
  { value: "America/Caracas", label: "Caracas (GMT-4)", group: "América" },
  { value: "America/Montevideo", label: "Montevideo (GMT-3)", group: "América" },

  // Otros
  { value: "America/New_York", label: "Nueva York (GMT-5/-4)", group: "Otros" },
  { value: "America/Los_Angeles", label: "Los Ángeles (GMT-8/-7)", group: "Otros" },
] as const;

export const TIMEZONE_VALUES = TIMEZONES.map((t) => t.value);

export const TIMEZONE_GROUPS: Array<TimezoneOption["group"]> = [
  "España",
  "Europa",
  "América",
  "Otros",
];
