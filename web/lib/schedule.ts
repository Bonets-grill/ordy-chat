// web/lib/schedule.ts — parser tolerante del campo `agent_configs.schedule` y
// validador `isWithinSchedule(schedule, now, tz)`.
//
// El schedule es texto libre escrito por el dueño:
//   "Dom, Lun, Mar, Jue: 13:30-16:30 y 19:30-22:30. Mié: Cerrado. Vie, Sáb: 13:30-16:30 y 19:30-23:00"
//
// Filosofía:
//  - Si el parser NO puede entender el schedule (formato libre raro) → return
//    {open: true, reason: "unparseable"}. El sistema no rechaza nunca por
//    incertidumbre del parser. Mejor dejar pasar un pedido a 3am que rechazar
//    100 pedidos legítimos por un schedule mal escrito.
//  - El parser sí entiende el formato canónico ES y los días con prefijos
//    estándar (Lun/Mar/Mié/Jue/Vie/Sáb/Dom).
//  - Comparación en la TZ del tenant — si tz inválida, cae a Atlantic/Canary
//    como default seguro para Mario (España es Madrid o Canary).

const DAY_KEYS: Record<string, number> = {
  // ISO: Mon=1, Tue=2... Sun=0.
  // toLocaleString accepta los nombres en es-ES.
  dom: 0, dgo: 0, do: 0, sun: 0,
  lun: 1, mon: 1,
  mar: 2, tue: 2,
  mie: 3, "mié": 3, mier: 3, wed: 3,
  jue: 4, thu: 4,
  vie: 5, fri: 5,
  sab: 6, "sáb": 6, sat: 6,
};

type Window = { startMin: number; endMin: number };

function parseHHMM(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  if (h < 0 || h > 27 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** Parsea una sola línea/segmento "Día1, Día2: HH:MM-HH:MM y HH:MM-HH:MM" o "Día: Cerrado". */
function parseSegment(seg: string): { days: Set<number>; windows: Window[] } | null {
  const parts = seg.split(":");
  if (parts.length < 2) return null;
  const daysPart = parts[0]!.toLowerCase().trim();
  const restPart = parts.slice(1).join(":").trim();

  // Days: "Lun, Mar, Mié" → set
  const days = new Set<number>();
  for (const tok of daysPart.split(/[,\s]+/)) {
    const cleaned = tok.replace(/[. ]/g, "").trim();
    if (!cleaned) continue;
    const idx = DAY_KEYS[cleaned] ?? DAY_KEYS[cleaned.slice(0, 3)];
    if (idx === undefined) return null;
    days.add(idx);
  }
  if (days.size === 0) return null;

  // "Cerrado" / "closed" / "—" → windows vacíos = cerrado todo el día
  if (/cerrado|closed|^—$|^-$/i.test(restPart)) {
    return { days, windows: [] };
  }

  // Windows: "13:30-16:30 y 19:30-23:00" o "13:30-16:30, 19:30-23:00"
  const windows: Window[] = [];
  for (const w of restPart.split(/\s*(?:y|,| and )\s*/i)) {
    const m = w.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
    if (!m) return null;
    const start = parseHHMM(m[1]!);
    const end = parseHHMM(m[2]!);
    if (start === null || end === null) return null;
    windows.push({ startMin: start, endMin: end });
  }
  if (windows.length === 0) return null;
  return { days, windows };
}

/** Devuelve la ventana actual y si está abierto en `now` (en tz del tenant). */
export function isWithinSchedule(
  schedule: string | null | undefined,
  now: Date,
  tz: string,
): { open: boolean; reason: "unparseable" | "closed_day" | "out_of_window" | "open"; schedule: string } {
  const sched = (schedule ?? "").trim();
  if (!sched) return { open: true, reason: "unparseable", schedule: "" };

  // Hora local en TZ del tenant.
  let localDay: number;
  let localMin: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "Atlantic/Canary",
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "";
    const wdMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (!(wd in wdMap)) return { open: true, reason: "unparseable", schedule: sched };
    localDay = wdMap[wd]!;
    const h = parseInt(hh, 10);
    const m = parseInt(mm === "60" ? "0" : mm, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return { open: true, reason: "unparseable", schedule: sched };
    localMin = (h % 24) * 60 + m;
  } catch {
    return { open: true, reason: "unparseable", schedule: sched };
  }

  // Parsear todos los segmentos separados por "."
  const segments = sched.split(/[.\n]+/).map((s) => s.trim()).filter(Boolean);
  let foundDay = false;
  let foundWindow: Window | null = null;
  let dayHasWindows = false;
  for (const seg of segments) {
    const parsed = parseSegment(seg);
    if (!parsed) continue;
    if (!parsed.days.has(localDay)) continue;
    foundDay = true;
    if (parsed.windows.length === 0) {
      // Día declarado cerrado.
      return { open: false, reason: "closed_day", schedule: sched };
    }
    dayHasWindows = true;
    for (const w of parsed.windows) {
      if (localMin >= w.startMin && localMin <= w.endMin) {
        foundWindow = w;
        break;
      }
    }
    if (foundWindow) break;
  }

  // Si no encontramos NINGÚN segmento que cubra el día → no rechazamos
  // (schedule incompleto o formato libre). Mejor abrir que rechazar legítimo.
  if (!foundDay) return { open: true, reason: "unparseable", schedule: sched };

  if (!dayHasWindows) return { open: false, reason: "closed_day", schedule: sched };
  if (!foundWindow) return { open: false, reason: "out_of_window", schedule: sched };
  return { open: true, reason: "open", schedule: sched };
}
