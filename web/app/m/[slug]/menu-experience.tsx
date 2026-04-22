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

import { Minus, Plus, Send, ShoppingCart, Sparkles, X } from "lucide-react";
import * as React from "react";
import { DEFAULT_LANG, detectLang, type Lang, strings } from "./translations";

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
  items: ItemLite[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };

type CartLine = { itemId: string; qty: number };

const CART_STORAGE_PREFIX = "ordy-cart:";
const GREETING_SHOWN_PREFIX = "ordy-greeting-shown:";

export function MenuExperience(props: Props) {
  const { slug, tenantName, brandColor, phoneNumber, items } = props;

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

  const greetingKey = `${GREETING_SHOWN_PREFIX}${slug}`;

  // Auto-greeting a los 2s si primera visita.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const alreadyShown = window.sessionStorage.getItem(greetingKey);
    if (alreadyShown) return;
    const timer = window.setTimeout(() => {
      setGreetingBubbleOpen(true);
      window.sessionStorage.setItem(greetingKey, "1");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [greetingKey]);

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
    const nextMessages: ChatMsg[] = [...messages, { role: "user", content: clean }];
    setMessages(nextMessages);
    setInputText("");
    setSending(true);
    try {
      const r = await fetch(`/api/public/menu-chat/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as { response?: string };
      setMessages((prev) => [...prev, { role: "assistant", content: data.response ?? "" }]);
    } catch {
      setError(t.errorFallback);
    } finally {
      setSending(false);
    }
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
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {t.chatSubtitle}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
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
              className="flex gap-2 border-t border-stone-200 bg-white p-3"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={t.inputPlaceholder}
                disabled={sending}
                maxLength={2000}
                className="flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm focus:border-stone-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                aria-label={t.send}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white transition active:scale-95 hover:bg-emerald-600 disabled:bg-stone-300"
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
