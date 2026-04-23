// web/app/m/[slug]/menu-experience.tsx
//
// Client component que añade sobre la landing pública:
//   1. Mesero conversacional (FAB abajo-derecha que abre chat panel).
//      - Auto-greeting en idioma del navegador a los 2s de la primera visita.
//      - Conversación real vía /api/public/menu-chat/<slug> (proxea al brain.py).
//   2. Carrito: botón "+" junto a cada ítem (inyectado via data-attr) que
//      añade al estado local. Floating bar abajo con total + checkout que
//      abre WhatsApp con el pedido prefilled.
//   3. i18n: navigator.language → strings[lang].
//
// Puramente client-side con localStorage para estado. No toca DB ni endpoints
// existentes del dashboard.

"use client";

import { Headphones, HeadphoneOff, Mic, MicOff, Minus, Plus, Send, ShoppingCart, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import * as React from "react";
import { DEFAULT_LANG, detectLang, LANG_BCP47, type Lang, strings } from "./translations";
import { normalizeForSpeech } from "./speech-normalize";

type ItemLite = {
  id: string;
  name: string;
  priceCents: number;
  category: string | null;
};

type Props = {
  slug: string;
  tenantName: string;
  brandColor: string;
  phoneNumber: string | null;
  tableNumber?: string | null;
  items: ItemLite[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };

type CartLine = { itemId: string; qty: number };

const CART_STORAGE_PREFIX = "ordy-cart:";
const GREETING_SHOWN_PREFIX = "ordy-greeting-shown:";
const CHAT_DISMISSED_PREFIX = "ordy-chat-dismissed:";
// Historial del chat dentro de la misma pestaña: sobrevive a reloads
// forzados por el Service Worker (nuevo deploy → skipWaiting → reload) sin
// persistir entre sesiones (al cerrar Safari el pedido de hoy no debe
// aparecer mañana). Por tenant para no mezclar conversaciones.
const CHAT_MESSAGES_PREFIX = "ordy-chat-messages:";
const MAX_PERSISTED_MESSAGES = 40;
// Voice unlock persistido: tras un reload del SW no queremos re-mostrar el
// overlay gigante si el usuario ya había desbloqueado la voz. Los
// navegadores siguen requiriendo un gesture para speechSynthesis, pero
// cualquier siguiente tap (send, 🎧, mic) lo cubre — sin molestar con la
// cortina negra otra vez.
const VOICE_UNLOCKED_PREFIX = "ordy-voice-unlocked:";

function micSupportedSync(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    "MediaRecorder" in window
  );
}

// La normalización para TTS (emojis, URLs, precios, abreviaciones) vive en
// ./speech-normalize y se aplica antes de pasar el texto a speechSynthesis.

export function MenuExperience(props: Props) {
  const { slug, tenantName, brandColor, phoneNumber, tableNumber = null, items } = props;

  const [lang, setLang] = React.useState<Lang>(DEFAULT_LANG);
  const t = strings[lang];

  // Detección idioma en client-mount (evita hydration mismatch).
  React.useEffect(() => {
    setLang(detectLang());
  }, []);

  // ── Carrito ─────────────────────────────────────────────────
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const cartKey = `${CART_STORAGE_PREFIX}${slug}`;

  // Rehidratación desde localStorage.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(cartKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCart(
            parsed
              .filter((l) => l && typeof l.itemId === "string" && typeof l.qty === "number")
              .map((l) => ({ itemId: l.itemId, qty: Math.max(0, Math.min(99, l.qty | 0)) })),
          );
        }
      }
    } catch {
      // corrupto → ignorar
    }
  }, [cartKey]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // cuota llena → ignorar
    }
  }, [cart, cartKey]);

  const itemById = React.useMemo(() => {
    const m = new Map<string, ItemLite>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const cartLines = cart.filter((l) => l.qty > 0 && itemById.has(l.itemId));
  const totalCents = cartLines.reduce((sum, l) => {
    const item = itemById.get(l.itemId);
    return sum + (item ? item.priceCents * l.qty : 0);
  }, 0);
  const totalLabel = `${(totalCents / 100).toFixed(2).replace(".", ",")} €`;
  const cartQtyTotal = cartLines.reduce((s, l) => s + l.qty, 0);

  function addToCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === itemId);
      if (existing) {
        return prev.map((l) =>
          l.itemId === itemId ? { ...l, qty: Math.min(99, l.qty + 1) } : l,
        );
      }
      return [...prev, { itemId, qty: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) =>
      prev
        .map((l) => (l.itemId === itemId ? { ...l, qty: Math.max(0, l.qty - 1) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function clearCart() {
    setCart([]);
  }

  // ── Inyección de botones "+" junto a cada item en el DOM renderizado
  //    por el server component. Cada <li> de la carta tiene data-item-id.
  React.useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-item-id]");
    nodes.forEach((node) => {
      const id = node.dataset.itemId;
      if (!id) return;
      if (node.dataset.ordyEnhanced === "1") return;
      node.dataset.ordyEnhanced = "1";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "ml-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white shadow-sm transition active:scale-95 hover:bg-stone-800";
      btn.setAttribute("aria-label", t.add);
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        addToCart(id);
      });
      node.appendChild(btn);
    });
    // Cleanup no necesario: los data-ordy-enhanced evitan dobles inyecciones
    // en re-renders. Los botones viven dentro de <li> del DOM del SSR.
  }, [items, t.add]);

  // ── Chat ────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = React.useState(false);
  const [greetingBubbleOpen, setGreetingBubbleOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [inputText, setInputText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // ── Voz ────────────────────────────────────────────────────
  // Entrada: MediaRecorder → POST audio blob a /api/public/menu-voice-transcribe
  //   (Whisper server-side). Dos modos:
  //   - Manual push-to-talk (botón mic): tap para empezar, tap para parar.
  //   - Conversacional hands-free: VAD (AnalyserNode RMS) auto-stop tras
  //     silencio sostenido, y TTS `onend` auto-reanuda el mic → loop sin tocar.
  // Salida: speechSynthesis nativo (TTS) con toggle on/off por el usuario.
  //
  // IMPORTANTE: todos los navegadores bloquean autoplay de audio (incluido
  // speechSynthesis) sin un user gesture previo. Por eso exponemos un
  // overlay "toca para empezar" que desbloquea la voz en el primer tap;
  // hasta ese momento `voiceUnlocked=false` y speak() no hace nada.
  const [voiceEnabled, setVoiceEnabled] = React.useState(true);
  const [voiceUnlocked, setVoiceUnlocked] = React.useState(false);
  const [conversational, setConversational] = React.useState(false);
  const conversationalRef = React.useRef(false);
  React.useEffect(() => {
    conversationalRef.current = conversational;
  }, [conversational]);
  const [recording, setRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  // VAD (voice activity detection) — solo se monta cuando arrancamos con vad=true.
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const silenceStartRef = React.useRef<number | null>(null);
  const hadSpeechRef = React.useRef(false);
  const micSupported = React.useMemo(() => micSupportedSync(), []);

  const stopVAD = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    silenceStartRef.current = null;
    try {
      analyserRef.current?.disconnect();
    } catch {
      /* noop */
    }
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* noop */
      }
    }
  }, []);

  const speak = React.useCallback(
    (text: string, onDone?: () => void) => {
      if (typeof window === "undefined") {
        onDone?.();
        return;
      }
      if (!voiceEnabled || !voiceUnlocked) {
        onDone?.();
        return;
      }
      if (!("speechSynthesis" in window)) {
        onDone?.();
        return;
      }
      const clean = normalizeForSpeech(text, lang);
      if (!clean) {
        onDone?.();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = LANG_BCP47[lang];
        u.rate = 1.0;
        u.pitch = 1.0;
        let fired = false;
        const fire = () => {
          if (fired) return;
          fired = true;
          onDone?.();
        };
        u.onend = fire;
        u.onerror = fire;
        window.speechSynthesis.speak(u);
      } catch {
        // navegador bloquea autoplay → ignorar silenciosamente
        onDone?.();
      }
    },
    [voiceEnabled, voiceUnlocked, lang],
  );

  const stopSpeaking = React.useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
  }, []);

  const greetingKey = `${GREETING_SHOWN_PREFIX}${slug}`;
  const dismissedKey = `${CHAT_DISMISSED_PREFIX}${slug}`;
  const messagesKey = `${CHAT_MESSAGES_PREFIX}${slug}`;
  const voiceUnlockedKey = `${VOICE_UNLOCKED_PREFIX}${slug}`;

  // Rehidratación del voice unlock: si el usuario ya tocó la cortina negra
  // antes del reload forzado, no le volvemos a mostrar el overlay gigante.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(voiceUnlockedKey) === "1") {
        setVoiceUnlocked(true);
      }
    } catch {
      /* noop */
    }
  }, [voiceUnlockedKey]);

  // Rehidratación de mensajes: cargar historial de la sesión al montar.
  // Cubre el caso de un reload forzado por el Service Worker mid-pedido.
  const rehydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(messagesKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid: ChatMsg[] = parsed.filter(
        (m): m is ChatMsg =>
          typeof m === "object" &&
          m !== null &&
          (m as { role?: unknown }).role !== undefined &&
          ((m as ChatMsg).role === "user" || (m as ChatMsg).role === "assistant") &&
          typeof (m as ChatMsg).content === "string",
      );
      if (valid.length > 0) {
        setMessages(valid);
        setChatOpen(true); // si había conversación, el chat seguía abierto
      }
    } catch {
      /* storage corrupto → ignorar */
    }
  }, [messagesKey]);

  // Persistencia de mensajes a sessionStorage. Se ejecuta tras rehidratar
  // para no sobreescribir el historial con [] vacío en el primer render.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!rehydratedRef.current) return;
    try {
      if (messages.length === 0) {
        window.sessionStorage.removeItem(messagesKey);
      } else {
        const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
        window.sessionStorage.setItem(messagesKey, JSON.stringify(trimmed));
      }
    } catch {
      /* quota exceeded u otros: seguimos silentes */
    }
  }, [messages, messagesKey]);

  // Auto-abrir el chat con saludo al montar. Siempre que el user NO haya
  // cerrado explícitamente en esta sesión y no haya ya mensajes rehidratados.
  // Pequeño delay para que el idioma se haya detectado. TTS NO se reproduce
  // aquí — espera al user gesture del overlay (unlockVoice).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const userDismissed = window.sessionStorage.getItem(dismissedKey);
    if (userDismissed) return;
    const timer = window.setTimeout(() => {
      setChatOpen(true);
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        const intro = strings[lang].greeting(tenantName);
        return [{ role: "assistant", content: intro }];
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dismissedKey, lang, tenantName]);

  // Unlock: primer user gesture → desbloquea TTS + reproduce saludo.
  // Persistimos la preferencia en sessionStorage: tras un reload del SW no
  // volvemos a mostrar la cortina negra. El siguiente tap del usuario
  // (send, 🎧, mic) servirá como gesture para que speechSynthesis arranque.
  function unlockVoice() {
    if (voiceUnlocked) return;
    setVoiceUnlocked(true);
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(voiceUnlockedKey, "1");
    } catch {
      /* storage lleno / safari privado: seguimos */
    }
    if (!("speechSynthesis" in window)) return;
    const greetingText = normalizeForSpeech(strings[lang].greeting(tenantName), lang);
    if (!greetingText) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(greetingText);
      u.lang = LANG_BCP47[lang];
      u.rate = 1.0;
      u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch {
      /* autoplay bloqueado — el toggle 🔊 sigue funcional */
    }
  }

  // Keep greeting bubble useEffect as fallback (if user had dismissed chat
  // pero vuelve a la landing en la misma sesión).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const userDismissed = window.sessionStorage.getItem(dismissedKey);
    const alreadyShown = window.sessionStorage.getItem(greetingKey);
    if (!userDismissed || alreadyShown) return;
    const timer = window.setTimeout(() => {
      setGreetingBubbleOpen(true);
      window.sessionStorage.setItem(greetingKey, "1");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [greetingKey, dismissedKey]);

  // Scroll chat al final cuando cambian mensajes.
  React.useEffect(() => {
    if (chatOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, chatOpen, sending]);

  function openChatWithGreeting() {
    setGreetingBubbleOpen(false);
    setChatOpen(true);
    if (messages.length === 0) {
      setMessages([{ role: "assistant", content: t.greeting(tenantName) }]);
    }
  }

  function openChatEmpty() {
    setGreetingBubbleOpen(false);
    setChatOpen(true);
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setError(null);
    stopSpeaking();
    const nextMessages: ChatMsg[] = [...messages, { role: "user", content: clean }];
    setMessages(nextMessages);
    setInputText("");
    setSending(true);
    try {
      const r = await fetch(`/api/public/menu-chat/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          table_number: tableNumber,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as { response?: string };
      const reply = data.response ?? "";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      if (reply) {
        speak(reply, () => {
          // En modo conversacional: tras acabar la respuesta del mesero,
          // reabrir el mic automáticamente para que el cliente responda sin
          // tocar ningún botón.
          if (conversationalRef.current) {
            void startRecording(true);
          }
        });
      }
    } catch {
      setError(t.errorFallback);
    } finally {
      setSending(false);
    }
  }

  // ── Mic (grabación audio → /api/public/menu-voice-transcribe → Whisper) ─
  function pickMimeType(): string {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const m of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch {
        /* noop */
      }
    }
    return "";
  }

  async function transcribeAndSend(blob: Blob) {
    setTranscribing(true);
    setError(null);
    try {
      const typePart = blob.type.split(";")[0] || "audio/webm";
      const ext = (typePart.split("/")[1] ?? "webm").replace(/[^a-z0-9]/gi, "") || "webm";
      const fd = new FormData();
      fd.append("audio", blob, `voice.${ext}`);
      fd.append("lang", lang);
      const r = await fetch(`/api/public/menu-voice-transcribe/${slug}`, {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body?.error ?? `HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as { text?: string };
      const transcript = (data.text ?? "").trim();
      if (transcript) {
        await sendMessage(transcript);
      }
    } catch {
      setError(t.errorFallback);
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording(useVAD: boolean) {
    if (recording || transcribing || sending) return;
    if (!micSupported) {
      setError(t.errorFallback);
      return;
    }
    try {
      stopSpeaking();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mime = pickMimeType();
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      hadSpeechRef.current = false;
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        setRecording(false);
        stopVAD();
        try {
          mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
        } catch {
          /* noop */
        }
        mediaStreamRef.current = null;
        const hadSpeech = hadSpeechRef.current;
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        hadSpeechRef.current = false;
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mr.mimeType || mime || "audio/webm" });
        // Mínimo 300ms para evitar clics accidentales.
        if (blob.size < 2000) return;
        // En modo VAD: solo transcribir si realmente detectamos habla; evita
        // mandar ruido ambiente cuando el usuario no dijo nada.
        if (useVAD && !hadSpeech) return;
        void transcribeAndSend(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);

      if (useVAD && typeof window !== "undefined") {
        // VAD: AnalyserNode RMS sobre el mismo stream. Si <SPEECH_RMS por
        // SILENCE_MS tras detectar habla → auto-stop. MAX_MS es tope duro
        // por seguridad (ej: usuario se va del tab).
        type ACCtor = typeof AudioContext;
        const win = window as unknown as { AudioContext?: ACCtor; webkitAudioContext?: ACCtor };
        const AC = win.AudioContext ?? win.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          void ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Float32Array(analyser.fftSize);
        const SILENCE_MS = 1200;
        const SPEECH_RMS = 0.015;
        const MAX_MS = 20000;
        const startedAt = performance.now();
        silenceStartRef.current = null;

        const tick = () => {
          const a = analyserRef.current;
          if (!a) return;
          a.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          const now = performance.now();
          if (rms > SPEECH_RMS) {
            hadSpeechRef.current = true;
            silenceStartRef.current = null;
          } else if (hadSpeechRef.current) {
            if (silenceStartRef.current == null) silenceStartRef.current = now;
            if (now - silenceStartRef.current > SILENCE_MS) {
              try {
                mediaRecorderRef.current?.stop();
              } catch {
                /* noop */
              }
              return;
            }
          }
          if (now - startedAt > MAX_MS) {
            try {
              mediaRecorderRef.current?.stop();
            } catch {
              /* noop */
            }
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch {
      setRecording(false);
      stopVAD();
      setError(t.errorFallback);
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* noop */
    }
  }

  async function toggleMic() {
    if (transcribing || sending) return;
    if (recording) {
      stopRecording();
      return;
    }
    await startRecording(false);
  }

  function toggleConversational() {
    setConversational((prev) => {
      const next = !prev;
      if (!next) {
        // Apagar: cortar TTS y cualquier recording activo.
        stopSpeaking();
        if (recording) stopRecording();
      } else if (voiceUnlocked && !recording && !transcribing && !sending) {
        // Encender: arrancar la primera escucha de inmediato.
        void startRecording(true);
      }
      return next;
    });
  }

  function closeChat() {
    setChatOpen(false);
    stopSpeaking();
    setConversational(false);
    if (recording) stopRecording();
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(dismissedKey, "1");
      }
    } catch {
      /* noop */
    }
  }

  // Cleanup global: si el componente se desmonta con algo activo, cortar todo.
  React.useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      try {
        mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
      } catch {
        /* noop */
      }
      stopVAD();
    };
  }, [stopVAD]);

  function toggleVoice() {
    setVoiceEnabled((prev) => {
      const next = !prev;
      if (!next) stopSpeaking();
      return next;
    });
  }

  // ── WhatsApp checkout ──────────────────────────────────────
  const waDigits = (phoneNumber ?? "").replace(/\D/g, "");
  function buildOrderText(): string {
    const lines: string[] = [t.orderMessageIntro, ""];
    for (const l of cartLines) {
      const item = itemById.get(l.itemId);
      if (!item) continue;
      const price = `${((item.priceCents * l.qty) / 100).toFixed(2).replace(".", ",")} €`;
      lines.push(`- ${l.qty}× ${item.name} — ${price}`);
    }
    lines.push("", `${t.orderMessageTotal}: ${totalLabel}`);
    return lines.join("\n");
  }
  const checkoutHref = waDigits && cartLines.length > 0
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(buildOrderText())}`
    : null;

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      {/* Carrito flotante abajo — visible solo si hay items */}
      {cartLines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-stone-950 p-3 text-white shadow-2xl ring-1 ring-white/10">
            <div className="flex items-center gap-2">
              <div className="relative">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute -right-2 -top-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-stone-950">
                  {cartQtyTotal}
                </span>
              </div>
              <span className="font-semibold tabular-nums">{totalLabel}</span>
            </div>
            <a
              href={checkoutHref ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              {t.cartCheckout(totalLabel)}
            </a>
            <button
              type="button"
              onClick={clearCart}
              aria-label={t.close}
              className="rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Mini lista items (expandible, simple) */}
          <div className="mx-auto mt-2 max-h-32 max-w-2xl space-y-1 overflow-y-auto rounded-xl bg-white/95 p-3 text-xs shadow-lg ring-1 ring-stone-200 backdrop-blur">
            {cartLines.map((l) => {
              const item = itemById.get(l.itemId);
              if (!item) return null;
              return (
                <div key={l.itemId} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => removeFromCart(l.itemId)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-stone-700 transition hover:bg-stone-200"
                    aria-label={t.close}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center font-semibold tabular-nums text-stone-900">
                    {l.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => addToCart(l.itemId)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white transition hover:bg-stone-800"
                    aria-label={t.add}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <span className="ml-2 min-w-0 flex-1 truncate text-stone-700">{item.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                    {((item.priceCents * l.qty) / 100).toFixed(2).replace(".", ",")} €
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Overlay "toca para hablar" — requisito legal de autoplay en todos
          los navegadores. Al tocar, desbloquea TTS + reproduce saludo. */}
      {chatOpen && !voiceUnlocked && voiceEnabled ? (
        <button
          type="button"
          onClick={unlockVoice}
          aria-label={t.openChat}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-stone-950/90 p-8 text-center backdrop-blur-md transition active:bg-stone-950/95"
        >
          <div
            className="flex h-32 w-32 items-center justify-center rounded-full text-white shadow-2xl ring-[6px] ring-white/20"
            style={{ backgroundColor: brandColor }}
          >
            <Mic className="h-14 w-14 animate-pulse" />
          </div>
          <div className="max-w-sm space-y-3">
            <div className="text-2xl font-bold leading-tight text-white">
              {tenantName}
            </div>
            <div className="text-base leading-snug text-white/85">
              {t.greeting(tenantName)}
            </div>
            <div className="pt-2 text-sm font-semibold uppercase tracking-wider text-white">
              👆 {t.openChat}
            </div>
          </div>
          <div className="absolute bottom-8 text-[11px] text-white/50">
            {t.voiceOff} → <VolumeX className="inline h-3 w-3" />
          </div>
        </button>
      ) : null}

      {/* Chat panel */}
      {chatOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-end sm:justify-end sm:p-5">
          <div className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[620px] sm:rounded-2xl">
            {/* Header */}
            <header
              className="flex items-center gap-3 px-5 py-4 text-white"
              style={{ backgroundColor: "#111" }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full font-bold"
                style={{ backgroundColor: `${brandColor}44` }}
              >
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.chatTitle(tenantName)}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      conversational && recording ? "animate-pulse bg-rose-400" : "bg-emerald-400"
                    }`}
                  />
                  {conversational && recording ? t.listening : t.chatSubtitle}
                </div>
              </div>
              {micSupported && voiceEnabled ? (
                <button
                  type="button"
                  onClick={toggleConversational}
                  aria-label={conversational ? t.conversationOff : t.conversationOn}
                  title={conversational ? t.conversationOff : t.conversationOn}
                  className={`rounded-lg p-2 transition ${
                    conversational
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {conversational ? <Headphones className="h-5 w-5" /> : <HeadphoneOff className="h-5 w-5" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={voiceEnabled ? t.voiceOff : t.voiceOn}
                title={voiceEnabled ? t.voiceOff : t.voiceOn}
                className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                {voiceEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={closeChat}
                aria-label={t.close}
                className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-stone-50 px-4 py-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-stone-900 text-white"
                        : "bg-white text-stone-900 ring-1 ring-stone-200"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-stone-500 ring-1 ring-stone-200">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400" />
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0.15s]" />
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0.3s]" />
                    </span>
                  </div>
                </div>
              ) : null}
              {error ? (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
                  {error}
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(inputText);
              }}
              className="flex items-center gap-2 border-t border-stone-200 bg-white p-3"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={transcribing ? t.typing : t.inputPlaceholder}
                disabled={sending || transcribing || recording}
                maxLength={2000}
                className="flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm focus:border-stone-400 focus:outline-none disabled:opacity-60"
              />
              {micSupported ? (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={sending || transcribing}
                  aria-label={recording ? t.micStop : t.micStart}
                  title={recording ? t.micStop : t.micStart}
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50 ${
                    recording
                      ? "bg-rose-500 text-white animate-pulse"
                      : "bg-stone-200 text-stone-700 hover:bg-stone-300"
                  }`}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={sending || transcribing || !inputText.trim()}
                aria-label={t.send}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition active:scale-95 hover:bg-emerald-600 disabled:bg-stone-300"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {/* FAB + greeting bubble */}
      {!chatOpen ? (
        <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-6">
          {greetingBubbleOpen ? (
            <button
              type="button"
              onClick={openChatWithGreeting}
              className="max-w-[calc(100vw-5rem)] rounded-2xl bg-white px-4 py-3 text-left text-sm text-stone-900 shadow-xl ring-1 ring-stone-200 transition active:scale-[0.98] hover:shadow-2xl sm:max-w-xs"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                <Sparkles className="h-3 w-3" /> {t.chatTitle(tenantName)}
              </div>
              <div className="leading-snug">{t.greeting(tenantName)}</div>
            </button>
          ) : null}
          <button
            type="button"
            onClick={openChatEmpty}
            aria-label={t.openChat}
            className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl ring-4 ring-white/70 transition active:scale-95 hover:scale-105"
            style={{ backgroundColor: brandColor }}
          >
            <Sparkles className="h-6 w-6" />
          </button>
        </div>
      ) : null}
    </>
  );
}
