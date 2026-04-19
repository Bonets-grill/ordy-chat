/* Ordy-AgencIA — Shared components & icons */

const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

// ---- i18n ----
const I18N = {
  es: {
    nav_product: 'Producto',
    nav_usecases: 'Casos de uso',
    nav_pricing: 'Precios',
    nav_docs: 'Docs',
    nav_login: 'Entrar',
    nav_cta: 'Empezar gratis',

    hero_eyebrow: 'Plataforma para agencias de agentes IA',
    hero_title_1: 'Construye agentes IA',
    hero_title_2: 'para todo tipo de nichos.',
    hero_sub: 'Diseña, entrena y despliega agentes conversacionales para cada industria. Gestiona tus clientes desde un solo panel. Sin código. Sin fricción.',
    hero_cta_primary: 'Empezar gratis',
    hero_cta_secondary: 'Ver demo de 2 min',
    hero_note: 'Sin tarjeta · 14 días de prueba completa',

    social_proof: 'Usado por equipos en',
    stat_agents: 'agentes en producción',
    stat_agencies: 'agencias activas',
    stat_convos: 'conversaciones / mes',
    stat_uptime: 'uptime garantizado',

    features_eyebrow: 'Una plataforma, todo el stack',
    features_title: 'Lo que toda agencia necesita,\ndesde el día uno.',
    feat_1_title: 'Builder visual',
    feat_1_desc: 'Arrastra nodos, conecta flujos, prueba en vivo. Prompts, herramientas y memoria sin tocar una línea.',
    feat_2_title: 'White-label',
    feat_2_desc: 'Despliega bajo tu dominio, tus colores, tu identidad. Tus clientes nunca ven nuestra marca.',
    feat_3_title: 'Multi-tenant',
    feat_3_desc: 'Un workspace por cliente. Datos aislados, facturación separada, permisos granulares.',
    feat_4_title: 'Integraciones',
    feat_4_desc: 'WhatsApp, Instagram, Slack, HubSpot, Zapier, webhooks. Conecta con lo que ya usas.',
    feat_5_title: 'Analytics',
    feat_5_desc: 'Conversaciones, conversión, coste por token. Reportes automáticos que puedes compartir.',
    feat_6_title: 'Marketplace',
    feat_6_desc: 'Plantillas pre-entrenadas para e-commerce, salud, legal, educación, inmobiliaria y más.',

    how_eyebrow: 'Cómo funciona',
    how_title: 'De idea a agente\nen producción en 4 pasos.',
    how_1_title: 'Elige una plantilla',
    how_1_desc: 'O empieza en blanco. Tenemos 40+ agentes pre-entrenados por industria.',
    how_2_title: 'Entrena con tus datos',
    how_2_desc: 'Sube documentos, conecta bases de datos, añade ejemplos. El agente aprende tu negocio.',
    how_3_title: 'Prueba y ajusta',
    how_3_desc: 'Chatea en vivo. Evalúa respuestas. Itera prompts sin desplegar cada vez.',
    how_4_title: 'Despliega a tu cliente',
    how_4_desc: 'Web widget, WhatsApp, API. Factura desde tu cuenta. Tú cobras, nosotros servimos.',

    cases_eyebrow: 'Casos de uso',
    cases_title: 'Agentes listos para cada nicho.',
    cases_sub: 'Cada plantilla viene entrenada con vocabulario, flujos y guardrails específicos de la industria.',

    cta_title: 'Tu próxima agencia\nempieza aquí.',
    cta_sub: 'Empieza gratis. Escala cuando tus clientes lo hagan.',
    cta_button: 'Crear cuenta',

    footer_tagline: 'Infraestructura para agencias de IA.',
    footer_product: 'Producto',
    footer_resources: 'Recursos',
    footer_company: 'Empresa',
    footer_legal: 'Legal',

    // Signup
    signup_title: 'Crea tu agencia',
    signup_sub: 'Empieza con 14 días gratis. Sin tarjeta.',
    signup_email: 'Email de trabajo',
    signup_password: 'Contraseña',
    signup_company: 'Nombre de tu agencia',
    signup_niche: 'Nicho principal',
    signup_size: 'Tamaño del equipo',
    signup_continue: 'Continuar',
    signup_back: '← Volver',
    signup_has_account: '¿Ya tienes cuenta?',
    signup_login: 'Entrar',
    signup_step: 'Paso',
    signup_of: 'de',
    signup_finish: 'Crear agencia',

    // Dashboard
    dash_greeting: 'Buenas, ',
    dash_overview: 'Resumen',
    dash_agents: 'Agentes',
    dash_clients: 'Clientes',
    dash_analytics: 'Analítica',
    dash_billing: 'Facturación',
    dash_settings: 'Ajustes',
    dash_new_agent: 'Nuevo agente',
    dash_search: 'Buscar agentes, clientes…',
    dash_active: 'activos',
    dash_draft: 'borrador',
    dash_paused: 'pausado',

    // Builder
    builder_back: '← Dashboard',
    builder_save: 'Guardar',
    builder_publish: 'Publicar',
    builder_test: 'Probar',
    builder_tab_flow: 'Flujo',
    builder_tab_knowledge: 'Conocimiento',
    builder_tab_tools: 'Herramientas',
    builder_tab_deploy: 'Desplegar',
  },
  en: {
    nav_product: 'Product',
    nav_usecases: 'Use cases',
    nav_pricing: 'Pricing',
    nav_docs: 'Docs',
    nav_login: 'Log in',
    nav_cta: 'Start free',

    hero_eyebrow: 'The platform for AI-agent agencies',
    hero_title_1: 'Build AI agents',
    hero_title_2: 'for every niche.',
    hero_sub: 'Design, train and deploy conversational agents for any industry. Manage every client from one panel. No code. No friction.',
    hero_cta_primary: 'Start free',
    hero_cta_secondary: 'Watch 2-min demo',
    hero_note: 'No card · 14-day full trial',

    social_proof: 'Trusted by teams at',
    stat_agents: 'agents in production',
    stat_agencies: 'active agencies',
    stat_convos: 'conversations / month',
    stat_uptime: 'guaranteed uptime',

    features_eyebrow: 'One platform, the whole stack',
    features_title: 'Everything an agency needs,\nfrom day one.',
    feat_1_title: 'Visual builder',
    feat_1_desc: 'Drag nodes, wire flows, test live. Prompts, tools and memory without a single line of code.',
    feat_2_title: 'White-label',
    feat_2_desc: 'Ship on your domain, your colors, your brand. Clients never see ours.',
    feat_3_title: 'Multi-tenant',
    feat_3_desc: 'One workspace per client. Isolated data, separate billing, granular permissions.',
    feat_4_title: 'Integrations',
    feat_4_desc: 'WhatsApp, Instagram, Slack, HubSpot, Zapier, webhooks. Plug into what you already use.',
    feat_5_title: 'Analytics',
    feat_5_desc: 'Conversations, conversion, cost per token. Automated reports you can share.',
    feat_6_title: 'Marketplace',
    feat_6_desc: 'Pre-trained templates for e-commerce, health, legal, education, real estate and more.',

    how_eyebrow: 'How it works',
    how_title: 'From idea to agent\nin production, in 4 steps.',
    how_1_title: 'Pick a template',
    how_1_desc: 'Or start blank. 40+ pre-trained agents by industry, ready to remix.',
    how_2_title: 'Train on your data',
    how_2_desc: 'Upload documents, connect databases, add examples. The agent learns your business.',
    how_3_title: 'Test and tune',
    how_3_desc: 'Chat live. Evaluate answers. Iterate prompts without redeploying every time.',
    how_4_title: 'Ship to your client',
    how_4_desc: 'Web widget, WhatsApp, API. Bill from your account. You charge, we serve.',

    cases_eyebrow: 'Use cases',
    cases_title: 'Agents ready for every niche.',
    cases_sub: 'Each template ships with industry-specific vocabulary, flows and guardrails.',

    cta_title: 'Your next agency\nstarts here.',
    cta_sub: 'Start free. Scale when your clients do.',
    cta_button: 'Create account',

    footer_tagline: 'Infrastructure for AI agencies.',
    footer_product: 'Product',
    footer_resources: 'Resources',
    footer_company: 'Company',
    footer_legal: 'Legal',

    signup_title: 'Create your agency',
    signup_sub: 'Start your 14-day free trial. No card.',
    signup_email: 'Work email',
    signup_password: 'Password',
    signup_company: 'Agency name',
    signup_niche: 'Main niche',
    signup_size: 'Team size',
    signup_continue: 'Continue',
    signup_back: '← Back',
    signup_has_account: 'Already have an account?',
    signup_login: 'Log in',
    signup_step: 'Step',
    signup_of: 'of',
    signup_finish: 'Create agency',

    dash_greeting: 'Hey, ',
    dash_overview: 'Overview',
    dash_agents: 'Agents',
    dash_clients: 'Clients',
    dash_analytics: 'Analytics',
    dash_billing: 'Billing',
    dash_settings: 'Settings',
    dash_new_agent: 'New agent',
    dash_search: 'Search agents, clients…',
    dash_active: 'active',
    dash_draft: 'draft',
    dash_paused: 'paused',

    builder_back: '← Dashboard',
    builder_save: 'Save',
    builder_publish: 'Publish',
    builder_test: 'Test',
    builder_tab_flow: 'Flow',
    builder_tab_knowledge: 'Knowledge',
    builder_tab_tools: 'Tools',
    builder_tab_deploy: 'Deploy',
  },
};

// ---- Context ----
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

// ---- Icons (simple, drawn as SVG) ----
const Icon = ({ name, size = 16, stroke = 1.6 }) => {
  const s = size;
  const paths = {
    arrow_right: <path d="M4 10h12m-4-4 4 4-4 4" />,
    arrow_up_right: <path d="M6 14 14 6m0 0H7m7 0v7" />,
    check: <path d="m4 10 4 4 8-8" />,
    spark: <path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.8 2.8M11.7 11.7l2.8 2.8M5.5 14.5l2.8-2.8M11.7 8.3l2.8-2.8" />,
    grid: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>,
    layers: <><path d="m10 3-7 4 7 4 7-4-7-4Z" /><path d="m3 11 7 4 7-4" /><path d="m3 15 7 4 7-4" /></>,
    bolt: <path d="M11 2 4 12h5l-1 6 7-10h-5l1-6Z" />,
    plug: <><path d="M7 7V3m6 4V3M5 7h10v4a5 5 0 0 1-5 5v0a5 5 0 0 1-5-5V7Z" /><path d="M10 16v4" /></>,
    chart: <><path d="M3 17h14" /><path d="M6 17v-5M10 17V8M14 17v-8" /></>,
    shop: <><path d="M3 7h14l-1 10H4L3 7Z" /><path d="M7 7V5a3 3 0 0 1 6 0v2" /></>,
    search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 4 4" /></>,
    plus: <path d="M10 4v12M4 10h12" />,
    menu: <><path d="M3 6h14M3 10h14M3 14h14" /></>,
    user: <><circle cx="10" cy="7" r="3" /><path d="M4 17a6 6 0 0 1 12 0" /></>,
    bell: <><path d="M6 8a4 4 0 0 1 8 0c0 3 1 5 2 6H4c1-1 2-3 2-6Z" /><path d="M8 17a2 2 0 0 0 4 0" /></>,
    bot: <><rect x="4" y="6" width="12" height="10" rx="2" /><path d="M10 3v3M7 11v1M13 11v1" /></>,
    folder: <path d="M3 6a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />,
    settings: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2v2m0 12v2m8-8h-2M4 10H2m13.5-5.5-1.5 1.5M6 14l-1.5 1.5m11 0L14 14M6 6 4.5 4.5" /></>,
    logout: <><path d="M12 4h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" /><path d="M8 10h8m0 0-3-3m3 3-3 3" /></>,
    dot: <circle cx="10" cy="10" r="3" />,
    dots: <><circle cx="5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></>,
    play: <path d="M7 5v10l8-5-8-5Z" />,
    whatsapp: <><path d="M4 16 5 13a7 7 0 1 1 3 3l-4 0Z" /></>,
    globe: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7Z" /></>,
    book: <path d="M4 4h5a3 3 0 0 1 3 3v10a2 2 0 0 0-2-2H4V4ZM16 4h-5a3 3 0 0 0-3 3v10a2 2 0 0 1 2-2h6V4Z" />,
    star: <path d="m10 3 2.2 4.5L17 8.2l-3.5 3.4.8 4.9L10 14.2l-4.3 2.3.8-4.9L3 8.2l4.8-.7L10 3Z" />,
    shield: <path d="M10 3 4 5v5c0 4 2.5 7 6 8 3.5-1 6-4 6-8V5l-6-2Z" />,
  };
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
};

// ---- Logo ----
const Logo = ({ size = 22 }) => (
  <div className="row gap-2" style={{ alignItems: 'center' }}>
    <div style={{
      width: size, height: size,
      borderRadius: 6,
      background: 'var(--ink)',
      color: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-display)',
      fontSize: size * 0.7,
      lineHeight: 1,
      fontWeight: 400,
    }}>ø</div>
    <span style={{
      fontFamily: 'var(--font-display)',
      fontSize: size * 0.82,
      letterSpacing: '-0.01em',
      fontWeight: 400,
    }}>Ordy<span style={{ fontStyle: 'italic', color: 'var(--accent-ink)' }}>·</span>AgencIA</span>
  </div>
);

// ---- Tweaks Panel ----
const ACCENTS = [
  { h: 120, label: 'Oliva' },
  { h: 60,  label: 'Arena' },
  { h: 25,  label: 'Terra' },
  { h: 250, label: 'Tinta' },
  { h: 320, label: 'Rosa' },
];

const TweaksPanel = () => {
  const app = useApp();
  if (!app.editMode) return null;
  return (
    <div className="tweaks-panel visible">
      <h4>Tweaks</h4>
      <div className="tweaks-row">
        <label>Idioma</label>
        <div className="tweaks-seg">
          <button className={app.lang === 'es' ? 'active' : ''} onClick={() => app.set({ lang: 'es' })}>ES</button>
          <button className={app.lang === 'en' ? 'active' : ''} onClick={() => app.set({ lang: 'en' })}>EN</button>
        </div>
      </div>
      <div className="tweaks-row">
        <label>Tema</label>
        <div className="tweaks-seg">
          <button className={app.theme === 'light' ? 'active' : ''} onClick={() => app.set({ theme: 'light' })}>Claro</button>
          <button className={app.theme === 'dark' ? 'active' : ''} onClick={() => app.set({ theme: 'dark' })}>Oscuro</button>
        </div>
      </div>
      <div className="tweaks-row">
        <label>Acento</label>
        <div className="tweaks-swatches">
          {ACCENTS.map(a => (
            <button
              key={a.h}
              className={'tweaks-sw' + (app.accentH === a.h ? ' active' : '')}
              title={a.label}
              onClick={() => app.set({ accentH: a.h })}
              style={{ background: `oklch(0.55 0.09 ${a.h})` }}
            />
          ))}
        </div>
      </div>
      <div className="tweaks-row">
        <label>Densidad</label>
        <div className="tweaks-seg">
          <button className={app.density === 'compact' ? 'active' : ''} onClick={() => app.set({ density: 'compact' })}>Compacta</button>
          <button className={app.density === 'normal' ? 'active' : ''} onClick={() => app.set({ density: 'normal' })}>Normal</button>
        </div>
      </div>
      <div className="tweaks-row">
        <label>Landing</label>
        <div className="tweaks-seg">
          <button className={app.landingVariant === 'editorial' ? 'active' : ''} onClick={() => app.set({ landingVariant: 'editorial' })}>Editorial</button>
          <button className={app.landingVariant === 'mono' ? 'active' : ''} onClick={() => app.set({ landingVariant: 'mono' })}>Mono</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  I18N, AppContext, useApp, Icon, Logo, TweaksPanel, ACCENTS,
});
