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
  errorNoSpeech: string;
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
  conversationOn: string;
  conversationOff: string;
  listening: string;
  // Fase 2 sesión de mesa: badge de cabecera + modal X-guard.
  tableLabel: (mesa: string) => string;
  sessionStatusPending: string;
  sessionStatusActive: string;
  sessionStatusBilling: string;
  sessionStatusPaid: string;
  closeGuardTitle: string;
  closeGuardBody: (total: string) => string;
  closeGuardContinue: string;
  // Nueva cortina de bienvenida: chooser entre chat de texto y voz.
  chooseChat: string;
  chooseVoice: string;
  // Mig 042 — picker de modificadores de producto.
  modifierRequired: string;
  modifierOptional: string;
  modifierMinSelect: (min: string) => string;
  modifierMaxSelect: (max: string) => string;
  modifierConfirm: string;
  modifierConfirmWithTotal: (total: string) => string;
  modifierLoading: string;
  modifierError: string;
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
    errorNoSpeech: "No te hemos escuchado bien. Mantén pulsado el micro mientras hablas.",
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
    conversationOn: "Conversación continua",
    conversationOff: "Detener conversación",
    listening: "Te escucho…",
    tableLabel: (m) => `Mesa ${m}`,
    sessionStatusPending: "Preparando",
    sessionStatusActive: "En cocina",
    sessionStatusBilling: "Cuenta pedida",
    sessionStatusPaid: "Pagado",
    closeGuardTitle: "Tenéis un pedido en marcha",
    closeGuardBody: (t) =>
      `No podemos cerrar el chat hasta que paguéis. Total actual: ${t}. Cuando queráis la cuenta, pedídmela aquí.`,
    closeGuardContinue: "Seguir aquí",
    chooseChat: "Quiero chatear",
    chooseVoice: "Hablar con el mesero",
    modifierRequired: "Obligatorio",
    modifierOptional: "Opcional",
    modifierMinSelect: (m) => `Selecciona al menos ${m}`,
    modifierMaxSelect: (m) => `Máx ${m}`,
    modifierConfirm: "Confirmar",
    modifierConfirmWithTotal: (t) => `Confirmar · ${t}`,
    modifierLoading: "Cargando opciones…",
    modifierError: "No pudimos cargar las opciones. Inténtalo otra vez.",
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
    errorNoSpeech: "We didn't catch that. Hold the mic while you speak.",
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
    conversationOn: "Hands-free chat",
    conversationOff: "Stop conversation",
    listening: "Listening…",
    tableLabel: (m) => `Table ${m}`,
    sessionStatusPending: "Preparing",
    sessionStatusActive: "In the kitchen",
    sessionStatusBilling: "Bill requested",
    sessionStatusPaid: "Paid",
    closeGuardTitle: "You have an open order",
    closeGuardBody: (t) =>
      `We can't close the chat until you pay. Current total: ${t}. When you're ready for the bill, ask me here.`,
    closeGuardContinue: "Keep chatting",
    chooseChat: "I'll type",
    chooseVoice: "Talk to the waiter",
    modifierRequired: "Required",
    modifierOptional: "Optional",
    modifierMinSelect: (m) => `Pick at least ${m}`,
    modifierMaxSelect: (m) => `Max ${m}`,
    modifierConfirm: "Confirm",
    modifierConfirmWithTotal: (t) => `Confirm · ${t}`,
    modifierLoading: "Loading options…",
    modifierError: "Couldn't load options. Please try again.",
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
    errorNoSpeech: "On ne vous a pas bien entendu. Maintenez le micro en parlant.",
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
    conversationOn: "Conversation continue",
    conversationOff: "Arrêter la conversation",
    listening: "J'écoute…",
    tableLabel: (m) => `Table ${m}`,
    sessionStatusPending: "En préparation",
    sessionStatusActive: "En cuisine",
    sessionStatusBilling: "Addition demandée",
    sessionStatusPaid: "Payé",
    closeGuardTitle: "Vous avez une commande en cours",
    closeGuardBody: (t) =>
      `Nous ne pouvons pas fermer le chat avant le paiement. Total actuel : ${t}. Pour l'addition, demandez-la-moi ici.`,
    closeGuardContinue: "Rester ici",
    chooseChat: "Je préfère écrire",
    chooseVoice: "Parler au serveur",
    modifierRequired: "Obligatoire",
    modifierOptional: "Facultatif",
    modifierMinSelect: (m) => `Choisis au moins ${m}`,
    modifierMaxSelect: (m) => `Max ${m}`,
    modifierConfirm: "Confirmer",
    modifierConfirmWithTotal: (t) => `Confirmer · ${t}`,
    modifierLoading: "Chargement…",
    modifierError: "Impossible de charger les options. Réessayez.",
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
    errorNoSpeech: "Wir haben dich nicht verstanden. Halte das Mikro gedrückt, während du sprichst.",
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
    conversationOn: "Freisprech-Modus",
    conversationOff: "Gespräch beenden",
    listening: "Ich höre zu…",
    tableLabel: (m) => `Tisch ${m}`,
    sessionStatusPending: "In Vorbereitung",
    sessionStatusActive: "In der Küche",
    sessionStatusBilling: "Rechnung gewünscht",
    sessionStatusPaid: "Bezahlt",
    closeGuardTitle: "Ihr habt eine offene Bestellung",
    closeGuardBody: (t) =>
      `Wir können den Chat nicht schließen, bis bezahlt ist. Aktuelle Summe: ${t}. Für die Rechnung fragt mich hier.`,
    closeGuardContinue: "Hier bleiben",
    chooseChat: "Ich schreibe lieber",
    chooseVoice: "Mit dem Kellner sprechen",
    modifierRequired: "Pflicht",
    modifierOptional: "Optional",
    modifierMinSelect: (m) => `Mindestens ${m} wählen`,
    modifierMaxSelect: (m) => `Max ${m}`,
    modifierConfirm: "Bestätigen",
    modifierConfirmWithTotal: (t) => `Bestätigen · ${t}`,
    modifierLoading: "Optionen werden geladen…",
    modifierError: "Optionen konnten nicht geladen werden. Bitte erneut versuchen.",
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
    errorNoSpeech: "Non ti abbiamo sentito bene. Tieni premuto il microfono mentre parli.",
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
    conversationOn: "Conversazione continua",
    conversationOff: "Ferma conversazione",
    listening: "Ti ascolto…",
    tableLabel: (m) => `Tavolo ${m}`,
    sessionStatusPending: "In preparazione",
    sessionStatusActive: "In cucina",
    sessionStatusBilling: "Conto richiesto",
    sessionStatusPaid: "Pagato",
    closeGuardTitle: "Avete un ordine in corso",
    closeGuardBody: (t) =>
      `Non possiamo chiudere la chat finché non pagate. Totale attuale: ${t}. Per il conto, chiedetemelo qui.`,
    closeGuardContinue: "Restiamo qui",
    chooseChat: "Preferisco scrivere",
    chooseVoice: "Parlare col cameriere",
    modifierRequired: "Obbligatorio",
    modifierOptional: "Facoltativo",
    modifierMinSelect: (m) => `Scegli almeno ${m}`,
    modifierMaxSelect: (m) => `Max ${m}`,
    modifierConfirm: "Conferma",
    modifierConfirmWithTotal: (t) => `Conferma · ${t}`,
    modifierLoading: "Caricamento…",
    modifierError: "Impossibile caricare le opzioni. Riprova.",
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
    errorNoSpeech: "Não te ouvimos bem. Mantém o micro premido enquanto falas.",
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
    conversationOn: "Conversa contínua",
    conversationOff: "Parar conversa",
    listening: "Estou a ouvir…",
    tableLabel: (m) => `Mesa ${m}`,
    sessionStatusPending: "A preparar",
    sessionStatusActive: "Na cozinha",
    sessionStatusBilling: "Conta pedida",
    sessionStatusPaid: "Pago",
    closeGuardTitle: "Têm um pedido em curso",
    closeGuardBody: (t) =>
      `Não podemos fechar o chat até que paguem. Total atual: ${t}. Para a conta, peçam-me aqui.`,
    closeGuardContinue: "Ficar aqui",
    chooseChat: "Prefiro escrever",
    chooseVoice: "Falar com o empregado",
    modifierRequired: "Obrigatório",
    modifierOptional: "Opcional",
    modifierMinSelect: (m) => `Escolhe pelo menos ${m}`,
    modifierMaxSelect: (m) => `Máx ${m}`,
    modifierConfirm: "Confirmar",
    modifierConfirmWithTotal: (t) => `Confirmar · ${t}`,
    modifierLoading: "A carregar…",
    modifierError: "Não foi possível carregar as opções. Tenta de novo.",
  },
};
