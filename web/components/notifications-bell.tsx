"use client";

// Campanita de notificaciones del dashboard. Poll cada 8s contra
// /api/tenant/messages/poll. Si llegan mensajes WA nuevos, dispara
// Notification API nativa (sonido del SO) y marca un badge en la
// cabecera. Botón toggle permite habilitar/deshabilitar (pide permiso
// del navegador la primera vez).

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAlert } from "@/components/ui/confirm-dialog";

const STORAGE_KEY = "ordy-wa-notify-enabled";
const SEEN_KEY = "ordy-wa-notify-last-seen";
const NOTIFIED_IDS_KEY = "ordy-wa-notified-ids"; // dedupe entre refresh

type Preview = {
  id: string;
  conversationId: string;
  from: string;
  content: string;
  createdAt: string;
};

// Carga IDs ya notificados (TTL 1h — los más viejos se borran).
function loadNotifiedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NOTIFIED_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { id: string; ts: number }[];
    const cutoff = Date.now() - 60 * 60_000;
    return new Set(parsed.filter((e) => e.ts > cutoff).map((e) => e.id));
  } catch {
    return new Set();
  }
}

function persistNotifiedIds(ids: Set<string>) {
  try {
    const cutoff = Date.now() - 60 * 60_000;
    const arr = Array.from(ids).map((id) => ({ id, ts: Date.now() }));
    window.localStorage.setItem(
      NOTIFIED_IDS_KEY,
      JSON.stringify(arr.filter((e) => e.ts > cutoff).slice(-200)),
    );
  } catch {
    /* noop */
  }
}

export function NotificationsBell() {
  const alert = useAlert();
  const [enabled, setEnabled] = useState(false);
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef<string>(new Date().toISOString());
  const timerRef = useRef<number | null>(null);
  // Dedupe: set de message IDs ya notificados en esta sesión + las últimas
  // 1h vía localStorage. Evita que múltiples pestañas o reloads disparen
  // la misma notificación N veces (bug Bonets 2026-04-26).
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        setEnabled(true);
      }
      const lastSeen = window.localStorage.getItem(SEEN_KEY);
      if (lastSeen) lastSeenRef.current = lastSeen;
      notifiedIdsRef.current = loadNotifiedIds();
    } catch {
      /* noop */
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const url = `/api/tenant/messages/poll?since=${encodeURIComponent(lastSeenRef.current)}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as {
        count: number;
        latestCreatedAt: string;
        previews: Preview[];
      };
      if (data.count > 0) {
        // Dedupe: filtra previews ya notificados en esta sesión + last 1h
        // (evita que múltiples pestañas o reloads disparen notif duplicada
        // del mismo mensaje — bug Bonets 2026-04-26).
        const fresh = data.previews.filter((p) => !notifiedIdsRef.current.has(p.id));
        if (fresh.length === 0) {
          // Todos eran duplicados — solo avanza el cursor, sin sonar ni contar.
          lastSeenRef.current = data.latestCreatedAt;
          try { window.localStorage.setItem(SEEN_KEY, data.latestCreatedAt); } catch { /* noop */ }
          return;
        }
        setUnread((prev) => prev + fresh.length);
        // Skip notification del SO si Mario tiene la pestaña visible — ya
        // está mirando el dashboard, no necesita ruido.
        const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
        // Disparamos UNA sola Notificación del SO con el más reciente nuevo
        // para no spamear. El sonido lo pone el SO.
        if (
          hidden &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          const p = fresh[0]!;
          try {
            new Notification(`WhatsApp · ${p.from}`, {
              body: p.content,
              tag: `ordy-wa-${p.conversationId}`,
              icon: "/icon-192.png",
            });
          } catch {
            /* noop */
          }
        }
        // Marca como notificados para no repetir.
        for (const p of fresh) notifiedIdsRef.current.add(p.id);
        persistNotifiedIds(notifiedIdsRef.current);
      }
      lastSeenRef.current = data.latestCreatedAt;
      try {
        window.localStorage.setItem(SEEN_KEY, data.latestCreatedAt);
      } catch {
        /* noop */
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    void poll();
    timerRef.current = window.setInterval(() => void poll(), 8000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, poll]);

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      try {
        window.localStorage.setItem(STORAGE_KEY, "0");
      } catch {
        /* noop */
      }
      return;
    }
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    } else if (Notification.permission === "denied") {
      await alert({
        title: "Notificaciones bloqueadas",
        description: "Tu navegador bloqueó las notificaciones. Cámbialo desde los ajustes del sitio.",
      });
      return;
    }
    setEnabled(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
    setUnread(0);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={enabled ? "Notificaciones WhatsApp activas — pulsa para silenciar" : "Activar sonido de nuevos WhatsApp"}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-700 transition hover:bg-neutral-100"
    >
      {enabled ? <Bell className="h-5 w-5 text-emerald-600" /> : <BellOff className="h-5 w-5" />}
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
