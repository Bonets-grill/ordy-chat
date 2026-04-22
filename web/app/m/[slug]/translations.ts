// web/app/m/[slug]/translations.ts
//
// Strings i18n del widget público de menú (mesero conversacional + carrito).
// Cliente detecta idioma por navigator.language. Si no hay match exacto,
// fallback a español. Cubre 95% de turismo en Canarias (ES/EN/FR/DE/IT/PT).

export type Lang = "es" | "en" | "fr" | "de" | "it" | "pt";

export const DEFAULT_LANG: Lang = "es";
export const SUPPORTED_LANGS: readonly Lang[] = ["es", "en", "fr", "de", "it", "pt"] as const;

export function detectLang(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const raw = (navigator.language || "").toLowerCase().split("-")[0] as Lang;
  return (SUPPORTED_LANGS as readonly string[]).includes(raw) ? raw : DEFAULT_LANG;
}

type Copy = {
  greeting: (name: string) => string;
  openChat: string;
  chatTitle: (name: string) => string;
  chatSubtitle: string;
  inputPlaceholder: string;
  send: string;
  close: string;
  typing: string;
  errorFallback: string;
  cartEmpty: string;
  cartTitle: string;
  cartTotal: string;
  cartCheckout: (total: string) => string;
  cartCallCta: string;
  add: string;
  whatsappGreetingPrefix: string;
  orderMessageIntro: string;
  orderMessageTotal: string;
  tryRecommendation: string;
  voiceOn: string;
  voiceOff: string;
  micStart: string;
  micStop: string;
};

// Mapeo BCP-47 para Web Speech API (SpeechRecognition + SpeechSynthesis).
export const LANG_BCP47: Record<Lang, string> = {
  es: "es-ES",
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
};

export const strings: Record<Lang, Copy> = {
  es: {
    greeting: (n) => `¡Bienvenido a ${n}! ¿Quieres que te recomiende algo?`,
    openChat: "Habla con nosotros",
    chatTitle: (n) => `Asistente de ${n}`,
    chatSubtitle: "Respondemos al momento",
    inputPlaceholder: "Escribe tu mensaje…",
    send: "Enviar",
    close: "Cerrar",
    typing: "Escribiendo…",
    errorFallback: "Algo ha fallado. Intenta de nuevo.",
    cartEmpty: "Tu pedido está vacío",
    cartTitle: "Tu pedido",
    cartTotal: "Total",
    cartCheckout: (t) => `Pedir por WhatsApp · ${t}`,
    cartCallCta: "Añadir al pedido",
    add: "Añadir",
    whatsappGreetingPrefix: "Hola, vengo desde la web",
    orderMessageIntro: "Hola, quiero pedir:",
    orderMessageTotal: "Total",
    tryRecommendation: "Recomiéndame algo",
    voiceOn: "Activar voz",
    voiceOff: "Silenciar voz",
    micStart: "Hablar",
    micStop: "Parar",
  },
  en: {
    greeting: (n) => `Welcome to ${n}! Want a recommendation?`,
    openChat: "Chat with us",
    chatTitle: (n) => `${n} Assistant`,
    chatSubtitle: "We reply instantly",
    inputPlaceholder: "Type your message…",
    send: "Send",
    close: "Close",
    typing: "Typing…",
    errorFallback: "Something went wrong. Try again.",
    cartEmpty: "Your order is empty",
    cartTitle: "Your order",
    cartTotal: "Total",
    cartCheckout: (t) => `Order via WhatsApp · ${t}`,
    cartCallCta: "Add to order",
    add: "Add",
    whatsappGreetingPrefix: "Hi, I'm visiting from your website",
    orderMessageIntro: "Hi, I'd like to order:",
    orderMessageTotal: "Total",
    tryRecommendation: "Recommend something",
    voiceOn: "Enable voice",
    voiceOff: "Mute voice",
    micStart: "Speak",
    micStop: "Stop",
  },
  fr: {
    greeting: (n) => `Bienvenue à ${n} ! Voulez-vous une recommandation ?`,
    openChat: "Discuter avec nous",
    chatTitle: (n) => `Assistant ${n}`,
    chatSubtitle: "Réponse immédiate",
    inputPlaceholder: "Écrivez votre message…",
    send: "Envoyer",
    close: "Fermer",
    typing: "Écrit…",
    errorFallback: "Une erreur s'est produite. Réessayez.",
    cartEmpty: "Votre commande est vide",
    cartTitle: "Votre commande",
    cartTotal: "Total",
    cartCheckout: (t) => `Commander par WhatsApp · ${t}`,
    cartCallCta: "Ajouter",
    add: "Ajouter",
    whatsappGreetingPrefix: "Bonjour, je viens du site web",
    orderMessageIntro: "Bonjour, je voudrais commander :",
    orderMessageTotal: "Total",
    tryRecommendation: "Recommandez-moi",
    voiceOn: "Activer la voix",
    voiceOff: "Couper la voix",
    micStart: "Parler",
    micStop: "Arrêter",
  },
  de: {
    greeting: (n) => `Willkommen bei ${n}! Soll ich dir etwas empfehlen?`,
    openChat: "Mit uns chatten",
    chatTitle: (n) => `${n} Assistent`,
    chatSubtitle: "Wir antworten sofort",
    inputPlaceholder: "Deine Nachricht…",
    send: "Senden",
    close: "Schließen",
    typing: "Schreibt…",
    errorFallback: "Etwas ist schiefgelaufen. Versuche es erneut.",
    cartEmpty: "Deine Bestellung ist leer",
    cartTitle: "Deine Bestellung",
    cartTotal: "Summe",
    cartCheckout: (t) => `Bestellen per WhatsApp · ${t}`,
    cartCallCta: "Hinzufügen",
    add: "Hinzufügen",
    whatsappGreetingPrefix: "Hallo, ich komme von der Webseite",
    orderMessageIntro: "Hallo, ich möchte bestellen:",
    orderMessageTotal: "Summe",
    tryRecommendation: "Empfehle mir was",
    voiceOn: "Sprache aktivieren",
    voiceOff: "Sprache stummschalten",
    micStart: "Sprechen",
    micStop: "Stopp",
  },
  it: {
    greeting: (n) => `Benvenuto a ${n}! Vuoi un consiglio?`,
    openChat: "Chatta con noi",
    chatTitle: (n) => `Assistente ${n}`,
    chatSubtitle: "Rispondiamo subito",
    inputPlaceholder: "Scrivi il tuo messaggio…",
    send: "Invia",
    close: "Chiudi",
    typing: "Sta scrivendo…",
    errorFallback: "Qualcosa è andato storto. Riprova.",
    cartEmpty: "Il tuo ordine è vuoto",
    cartTitle: "Il tuo ordine",
    cartTotal: "Totale",
    cartCheckout: (t) => `Ordina via WhatsApp · ${t}`,
    cartCallCta: "Aggiungi",
    add: "Aggiungi",
    whatsappGreetingPrefix: "Ciao, vengo dal sito web",
    orderMessageIntro: "Ciao, vorrei ordinare:",
    orderMessageTotal: "Totale",
    tryRecommendation: "Consigliami qualcosa",
    voiceOn: "Attiva voce",
    voiceOff: "Disattiva voce",
    micStart: "Parla",
    micStop: "Stop",
  },
  pt: {
    greeting: (n) => `Bem-vindo ao ${n}! Quer uma recomendação?`,
    openChat: "Fala connosco",
    chatTitle: (n) => `Assistente ${n}`,
    chatSubtitle: "Respondemos já",
    inputPlaceholder: "Escreve a tua mensagem…",
    send: "Enviar",
    close: "Fechar",
    typing: "A escrever…",
    errorFallback: "Algo correu mal. Tenta outra vez.",
    cartEmpty: "O teu pedido está vazio",
    cartTitle: "O teu pedido",
    cartTotal: "Total",
    cartCheckout: (t) => `Pedir via WhatsApp · ${t}`,
    cartCallCta: "Adicionar",
    add: "Adicionar",
    whatsappGreetingPrefix: "Olá, venho do website",
    orderMessageIntro: "Olá, queria pedir:",
    orderMessageTotal: "Total",
    tryRecommendation: "Recomenda-me algo",
    voiceOn: "Ativar voz",
    voiceOff: "Silenciar voz",
    micStart: "Falar",
    micStop: "Parar",
  },
};
