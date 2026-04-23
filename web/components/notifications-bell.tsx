"use client";

// Campanita de notificaciones del dashboard. Poll cada 8s contra
// /api/tenant/messages/poll. Si llegan mensajes WA nuevos, dispara
// Notification API nativa (sonido del SO) y marca un badge en la
// cabecera. Botón toggle permite habilitar/deshabilitar (pide permiso
// del navegador la primera vez).

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ordy-wa-notify-enabled";
const SEEN_KEY = "ordy-wa-notify-last-seen";

type Preview = {
  id: string;
  conversationId: string;
  from: string;
  content: string;
  createdAt: string;
};

export function NotificationsBell() {
  const [enabled, setEnabled] = useState(false);
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef<string>(new Date().toISOString());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        setEnabled(true);
      }
      const lastSeen = window.localStorage.getItem(SEEN_KEY);
      if (lastSeen) lastSeenRef.current = lastSeen;
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
        setUnread((prev) => prev + data.count);
        // Disparamos una sola Notificación con el más reciente para no
        // spamear al staff. El sonido lo pone el sistema operativo.
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const p = data.previews[0];
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
      alert("Las notificaciones están bloqueadas por el navegador. Cámbialo en los ajustes del sitio.");
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
