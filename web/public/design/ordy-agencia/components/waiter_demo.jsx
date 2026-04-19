/* Ordy-AgencIA — Waiter demo with live n8n-style node activation */

const { useState: useStateW, useEffect: useEffectW, useRef: useRefW } = React;

const WAITER_SCRIPT = {
  es: [
    { role: 'user',   text: 'Buenas, ¿tienen algo sin gluten para compartir? Somos 2.', nodes: ['intent', 'memory'] },
    { role: 'bot',    text: 'Buenas 👋 Claro que sí. Para compartir les recomiendo la burrata con tomate confitado o los tacos de cochinita (ambos sin gluten). ¿Les armo una tabla?', nodes: ['menu', 'llm'] },
    { role: 'user',   text: 'La burrata suena bien. Y una copa de blanco seco que maride.', nodes: ['intent', 'tools'] },
    { role: 'bot',    text: 'Marido perfecto: un Albariño Rías Baixas 2022, copa 6,50€. ¿Lo añado y una botella de agua?', nodes: ['menu', 'llm'] },
    { role: 'user',   text: 'Sí, con gas. Y reserva la mesa 12 para las 21:15 a nombre de Clara.', nodes: ['intent', 'memory'] },
    { role: 'bot',    text: 'Hecho, Clara ✓ Mesa 12 a las 21:15, 2 personas, alergia: gluten anotada. Les avisaré al camarero.', nodes: ['pos', 'notify'] },
  ],
  en: [
    { role: 'user',   text: "Evening — got anything gluten-free to share? We're 2.", nodes: ['intent', 'memory'] },
    { role: 'bot',    text: 'Evening 👋 Absolutely. To share I\'d suggest the burrata with confit tomato or the cochinita tacos (both gluten-free). Want me to build a board?', nodes: ['menu', 'llm'] },
    { role: 'user',   text: 'Burrata sounds great. And a dry white that pairs.', nodes: ['intent', 'tools'] },
    { role: 'bot',    text: 'Perfect pairing: an Albariño Rías Baixas 2022, €6.50 a glass. Shall I add it and a bottle of water?', nodes: ['menu', 'llm'] },
    { role: 'user',   text: 'Sparkling please. And book table 12 for 9:15pm under Clara.', nodes: ['intent', 'memory'] },
    { role: 'bot',    text: 'Done, Clara ✓ Table 12 at 9:15pm, 2 guests, gluten allergy logged. I\'ll brief the waiter.', nodes: ['pos', 'notify'] },
  ],
};

// Node layout (percentages of canvas)
const NODES = [
  { id: 'whatsapp', x: 10, y: 50, label: 'WhatsApp',          sub: 'Inbound',     icon: 'whatsapp',  group: 'input' },
  { id: 'intent',   x: 26, y: 26, label: 'Intent',            sub: 'Clasifica',   icon: 'spark',     group: 'core'  },
  { id: 'memory',   x: 26, y: 74, label: 'Memoria',           sub: 'Cliente',     icon: 'user',      group: 'core'  },
  { id: 'menu',     x: 46, y: 20, label: 'Carta',             sub: 'Vector DB',   icon: 'book',      group: 'data'  },
  { id: 'tools',    x: 46, y: 50, label: 'Maridaje',          sub: 'Tool',        icon: 'plug',      group: 'data'  },
  { id: 'pos',      x: 46, y: 80, label: 'POS · Reservas',    sub: 'API',         icon: 'database',  group: 'data'  },
  { id: 'llm',      x: 68, y: 32, label: 'Claude',            sub: 'Respuesta',   icon: 'brain',     group: 'brain' },
  { id: 'notify',   x: 68, y: 70, label: 'Notificar',         sub: 'Camarero',    icon: 'bell',      group: 'brain' },
  { id: 'out',      x: 87, y: 50, label: 'Responder',         sub: 'Salida',      icon: 'arrow_right', group: 'output' },
];

const EDGES = [
  ['whatsapp', 'intent'], ['whatsapp', 'memory'],
  ['intent', 'menu'], ['intent', 'tools'], ['intent', 'pos'],
  ['memory', 'menu'], ['memory', 'pos'],
  ['menu', 'llm'], ['tools', 'llm'], ['pos', 'notify'],
  ['llm', 'out'], ['notify', 'out'],
];

const NODE_GROUP_COLOR = {
  input:  'oklch(0.72 0.15 180)',
  core:   'oklch(0.78 0.14 280)',
  data:   'oklch(0.80 0.15 80)',
  brain:  'oklch(0.80 0.18 330)',
  output: 'oklch(0.82 0.17 140)',
};

// Live metrics shown above the graph
const METRICS = [
  { key: 'latency',   es: 'Latencia',     en: 'Latency',     base: 420, suffix: 'ms', jitter: 40,  color: 'oklch(0.78 0.15 280)' },
  { key: 'tokens',    es: 'Tokens/s',     en: 'Tokens/s',    base: 182, suffix: '',   jitter: 25,  color: 'oklch(0.80 0.15 80)'  },
  { key: 'confidence',es: 'Confianza',    en: 'Confidence',  base: 94,  suffix: '%',  jitter: 3,   color: 'oklch(0.82 0.17 140)' },
  { key: 'tickets',   es: 'Resueltos hoy',en: 'Solved today',base: 847, suffix: '',   jitter: 2,   color: 'oklch(0.80 0.18 330)', mono: true },
];

const LiveMetric = ({ m, lang }) => {
  const [val, setVal] = useStateW(m.base);
  useEffectW(() => {
    const id = setInterval(() => {
      if (m.mono) setVal(v => v + (Math.random() < 0.4 ? 1 : 0));
      else setVal(m.base + Math.round((Math.random() - 0.5) * m.jitter * 2));
    }, 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{
      padding: '8px 12px',
      border: '1px solid var(--line)',
      background: 'color-mix(in oklch, var(--bg-card) 80%, transparent)',
      borderRadius: 10,
      minWidth: 92,
    }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
        {lang === 'es' ? m.es : m.en}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: m.color, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {val}{m.suffix}
      </div>
    </div>
  );
};

const WaiterNodeIcon = ({ name, size = 14 }) => {
  // Reuse the global Icon if it has the name, else render a dot
  if (typeof Icon === 'function') return <Icon name={name} size={size} />;
  return <span style={{ width: size, height: size, borderRadius: 999, background: 'currentColor', display: 'inline-block' }} />;
};

const Node = ({ n, active, pulsing }) => {
  const color = NODE_GROUP_COLOR[n.group];
  return (
    <div
      style={{
        position: 'absolute',
        left: `${n.x}%`, top: `${n.y}%`,
        transform: 'translate(-50%, -50%)',
        minWidth: 118,
        padding: '8px 10px',
        borderRadius: 12,
        background: active ? `color-mix(in oklch, ${color} 18%, var(--bg-card))` : 'var(--bg-card)',
        border: `1px solid ${active ? color : 'var(--line-strong)'}`,
        boxShadow: active
          ? `0 0 0 4px color-mix(in oklch, ${color} 25%, transparent), 0 0 24px color-mix(in oklch, ${color} 60%, transparent)`
          : '0 1px 0 rgba(0,0,0,0.15)',
        color: 'var(--ink)',
        fontSize: 11,
        transition: 'all 0.35s cubic-bezier(.2,.9,.25,1.1)',
        zIndex: 2,
      }}
    >
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span style={{
          width: 20, height: 20, borderRadius: 6,
          background: `color-mix(in oklch, ${color} 30%, transparent)`,
          color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <WaiterNodeIcon name={n.icon} size={11} />
        </span>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{n.label}</div>
          <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 1 }}>{n.sub}</div>
        </div>
        {pulsing && (
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: 'pulse 1s ease-in-out infinite',
            marginLeft: 'auto',
          }} />
        )}
      </div>
    </div>
  );
};

// Draw edges as SVG paths with flowing dashes when active
const NodeGraph = ({ activeNodes, activeEdges }) => {
  const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}
    >
      <defs>
        <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        <radialGradient id="packet-grad">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="70%" stopColor="white" stopOpacity="0.3" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      {EDGES.map(([a, b], i) => {
        const na = byId[a], nb = byId[b];
        if (!na || !nb) return null;
        const key = `${a}->${b}`;
        const isActive = activeEdges.has(key);
        const dx = nb.x - na.x;
        const cp1x = na.x + dx * 0.5;
        const cp1y = na.y;
        const cp2x = nb.x - dx * 0.5;
        const cp2y = nb.y;
        const d = `M ${na.x} ${na.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${nb.x} ${nb.y}`;
        const groupColor = NODE_GROUP_COLOR[nb.group] || 'var(--accent)';
        return (
          <g key={i}>
            <path id={`path-${i}`} d={d} fill="none" stroke="var(--line-strong)" strokeWidth="0.18" vectorEffect="non-scaling-stroke" />
            {isActive && (
              <>
                <path d={d} stroke={groupColor} strokeWidth="0.45" fill="none" opacity="0.9" vectorEffect="non-scaling-stroke" filter="url(#edge-glow)" />
                <path d={d} stroke={groupColor} strokeWidth="0.22" strokeDasharray="1.2 1.2" fill="none" vectorEffect="non-scaling-stroke" style={{ animation: 'edgeDash 1.1s linear infinite' }} />
                {/* Data packet traveling along path */}
                <circle r="0.9" fill={groupColor} filter="url(#edge-glow)">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path={d} />
                </circle>
                <circle r="0.5" fill="white">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path={d} />
                </circle>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
};

const ChatBubble = ({ msg, typing }) => {
  const isBot = msg.role === 'bot';
  return (
    <div style={{ display: 'flex', justifyContent: isBot ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
      <div
        className="fade-in"
        style={{
          maxWidth: '82%',
          padding: '9px 13px',
          borderRadius: 14,
          borderBottomLeftRadius: isBot ? 4 : 14,
          borderBottomRightRadius: isBot ? 14 : 4,
          background: isBot ? 'var(--bg-sunk)' : 'color-mix(in oklch, var(--accent) 88%, white)',
          color: isBot ? 'var(--ink)' : '#fff',
          fontSize: 13,
          lineHeight: 1.4,
          boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
        }}
      >
        {msg.text}
        {typing && <span className="typing-dot" />}
      </div>
    </div>
  );
};

const WaiterDemo = () => {
  const app = useApp();
  const script = WAITER_SCRIPT[app.lang] || WAITER_SCRIPT.es;
  const [shown, setShown] = useStateW([]);   // messages already displayed
  const [typingIdx, setTypingIdx] = useStateW(-1);
  const [activeNodes, setActiveNodes] = useStateW(new Set());
  const [activeEdges, setActiveEdges] = useStateW(new Set());
  const scrollRef = useRefW(null);
  const tRef = useRefW([]);

  // Lifecycle: loop through the script
  useEffectW(() => {
    let cancelled = false;
    const clear = () => tRef.current.forEach(t => clearTimeout(t));
    const sched = (fn, ms) => { const t = setTimeout(fn, ms); tRef.current.push(t); return t; };

    function runStep(i) {
      if (cancelled) return;
      if (i >= script.length) {
        sched(() => {
          setShown([]); setActiveNodes(new Set()); setActiveEdges(new Set());
          sched(() => runStep(0), 800);
        }, 2800);
        return;
      }
      const msg = script[i];
      const isBot = msg.role === 'bot';

      // Trigger node activation
      const nodes = new Set(['whatsapp', ...msg.nodes, isBot ? 'out' : 'intent']);
      setActiveNodes(nodes);
      // Edges: activate any edge whose both endpoints are in nodes
      const edges = new Set();
      EDGES.forEach(([a, b]) => { if (nodes.has(a) && nodes.has(b)) edges.add(`${a}->${b}`); });
      setActiveEdges(edges);

      if (isBot) {
        // Show typing indicator first
        setTypingIdx(i);
        setShown(prev => [...prev, { ...msg, text: '' }]);
        sched(() => {
          if (cancelled) return;
          setShown(prev => prev.map((m, idx) => idx === i ? msg : m));
          setTypingIdx(-1);
          sched(() => runStep(i + 1), 2400);
        }, 1100);
      } else {
        setShown(prev => [...prev, msg]);
        sched(() => runStep(i + 1), 2000);
      }
    }

    runStep(0);
    return () => { cancelled = true; clear(); };
    // eslint-disable-next-line
  }, [app.lang]);

  // Auto-scroll chat
  useEffectW(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [shown]);

  return (
    <section style={{ padding: '32px 28px 96px', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 13, color: 'var(--accent-ink)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            {app.lang === 'es' ? 'Demo en vivo · Restaurante Parábola' : 'Live demo · Parábola Restaurant'}
          </div>
          <h2 style={{ fontSize: 'clamp(32px, 4.2vw, 56px)', letterSpacing: '-0.03em', fontWeight: 700, margin: 0, lineHeight: 1.05, fontFamily: 'var(--font-display)' }}>
            {app.lang === 'es' ? (
              <>Un mesero digital, <em style={{ fontStyle: 'italic', fontWeight: 400 }}>pensando en tiempo real</em>.</>
            ) : (
              <>A digital waiter, <em style={{ fontStyle: 'italic', fontWeight: 400 }}>thinking in real time</em>.</>
            )}
          </h2>
          <p style={{ fontSize: 17, color: 'var(--ink-2)', marginTop: 16, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            {app.lang === 'es'
              ? 'Cada mensaje dispara un flujo de nodos: intención, memoria, carta, maridajes, POS. Míralo pensar.'
              : 'Every message fires a flow of nodes: intent, memory, menu, pairings, POS. Watch it think.'}
          </p>
        </div>

        <div
          className="waiter-demo-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '380px 1fr',
            gap: 24,
            alignItems: 'stretch',
          }}
        >
          {/* Left: phone / chat */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--line-strong)',
            borderRadius: 28,
            padding: 18,
            boxShadow: '0 24px 60px -30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset',
            display: 'flex', flexDirection: 'column',
            height: 620,
          }}>
            {/* WhatsApp header */}
            <div className="row between" style={{
              padding: '10px 6px 12px',
              borderBottom: '1px solid var(--line)',
              marginBottom: 12,
            }}>
              <div className="row gap-3">
                <div style={{
                  width: 40, height: 40, borderRadius: 999,
                  background: 'linear-gradient(135deg, oklch(0.78 0.14 140), oklch(0.68 0.16 160))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700,
                }}>P</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Parábola · {app.lang === 'es' ? 'Mesero' : 'Waiter'}</div>
                  <div className="row gap-2" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: 'oklch(0.72 0.17 150)', boxShadow: '0 0 6px oklch(0.72 0.17 150)' }} />
                    <span>{app.lang === 'es' ? 'En línea · responde al instante' : 'Online · instant replies'}</span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>WhatsApp</div>
            </div>

            {/* Chat */}
            <div ref={scrollRef} style={{
              flex: 1, overflowY: 'auto', padding: '4px 4px 8px',
              scrollBehavior: 'smooth',
            }}>
              {shown.map((m, i) => (
                <ChatBubble key={i} msg={m} typing={typingIdx === i && m.role === 'bot'} />
              ))}
            </div>

            {/* Composer */}
            <div style={{
              marginTop: 8, padding: '8px 12px',
              border: '1px solid var(--line)',
              borderRadius: 999,
              color: 'var(--ink-3)', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{app.lang === 'es' ? 'Escribe un mensaje…' : 'Type a message…'}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>🎙 📎 😊</span>
            </div>
          </div>

          {/* Right: node canvas */}
          <div style={{
            position: 'relative',
            background: `
              radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--line-strong) 80%, transparent) 1px, transparent 0) 0 0 / 22px 22px,
              var(--bg-sunk)
            `,
            border: '1px solid var(--line-strong)',
            borderRadius: 20,
            overflow: 'hidden',
            height: 620,
          }}>
            {/* Header chip */}
            <div style={{
              position: 'absolute', top: 14, left: 14, zIndex: 3,
              padding: '6px 12px', borderRadius: 999,
              background: 'color-mix(in oklch, var(--bg-card) 90%, transparent)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--line)',
              fontSize: 11, color: 'var(--ink-2)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: 999,
                background: 'oklch(0.72 0.17 150)',
                boxShadow: '0 0 8px oklch(0.72 0.17 150)',
                animation: 'pulse 1.2s ease-in-out infinite',
              }} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>flow · waiter-v1.2</span>
            </div>

            <div style={{
              position: 'absolute', top: 14, right: 14, zIndex: 3,
              padding: '6px 12px', borderRadius: 999,
              background: 'color-mix(in oklch, var(--bg-card) 90%, transparent)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--line)',
              fontSize: 11, color: 'var(--ink-2)',
              fontFamily: 'var(--font-mono)',
            }}>
              {activeNodes.size} / {NODES.length} {app.lang === 'es' ? 'nodos activos' : 'nodes active'}
            </div>

            {/* Inner padded area so nodes don't clip to edges */}
            <div style={{ position: 'absolute', inset: '60px 70px 60px 70px' }}>
              <NodeGraph activeNodes={activeNodes} activeEdges={activeEdges} />
              {NODES.map(n => (
                <Node
                  key={n.id}
                  n={n}
                  active={activeNodes.has(n.id)}
                  pulsing={activeNodes.has(n.id)}
                />
              ))}
            </div>

            {/* Live metrics strip */}
            <div style={{
              position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 3,
              display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap',
            }}>
              {METRICS.map(m => <LiveMetric key={m.key} m={m} lang={app.lang} />)}
            </div>
          </div>
        </div>

        {/* Bonus capability gallery — more agent ideas that impress */}
        <CapabilityGallery />
      </div>
    </section>
  );
};

// Gallery of impressive agent capabilities with micro-animations
const CAPABILITIES = [
  {
    k: 'voice',
    color: 'oklch(0.78 0.16 30)',
    es: { title: 'Voz en tiempo real', sub: 'Responde llamadas · 180ms latencia · clona la voz de tu marca' },
    en: { title: 'Real-time voice',    sub: 'Answers calls · 180ms latency · clones your brand voice' },
    render: 'voice',
  },
  {
    k: 'vision',
    color: 'oklch(0.78 0.16 200)',
    es: { title: 'Visión · OCR · facturas', sub: 'Lee tickets, DNIs, albaranes. Extrae campos estructurados.' },
    en: { title: 'Vision · OCR · invoices', sub: 'Reads receipts, IDs, delivery notes. Extracts fields.' },
    render: 'vision',
  },
  {
    k: 'memory',
    color: 'oklch(0.78 0.14 280)',
    es: { title: 'Memoria persistente', sub: 'Recuerda gustos, alergias y conversaciones entre canales.' },
    en: { title: 'Persistent memory',     sub: 'Remembers preferences, allergies, chats across channels.' },
    render: 'memory',
  },
  {
    k: 'handoff',
    color: 'oklch(0.80 0.15 140)',
    es: { title: 'Handoff a humano', sub: 'Detecta frustración y transfiere con contexto completo.' },
    en: { title: 'Human handoff',    sub: 'Detects frustration and transfers with full context.' },
    render: 'handoff',
  },
  {
    k: 'multilang',
    color: 'oklch(0.80 0.14 80)',
    es: { title: 'Multilingüe', sub: 'Detecta el idioma en el primer mensaje. 27 lenguas nativas.' },
    en: { title: 'Multilingual',sub: 'Detects language on first message. 27 native languages.' },
    render: 'lang',
  },
  {
    k: 'guardrails',
    color: 'oklch(0.80 0.16 330)',
    es: { title: 'Guardrails de marca', sub: 'No inventa precios, no promete envíos imposibles. Validado.' },
    en: { title: 'Brand guardrails',    sub: 'Never invents prices or ships promises it can\'t keep.' },
    render: 'guard',
  },
];

const CapCard = ({ c, lang }) => {
  return (
    <div style={{
      padding: 22,
      background: 'var(--bg-card)',
      border: '1px solid var(--line-strong)',
      borderRadius: 18,
      position: 'relative',
      overflow: 'hidden',
      minHeight: 200,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${c.color} 0%, transparent 70%)`,
        opacity: 0.22, filter: 'blur(8px)',
      }} />
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: `color-mix(in oklch, ${c.color} 25%, var(--bg-sunk))`,
        border: `1px solid ${c.color}`,
        color: c.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
        fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
      }}>
        <CapGlyph kind={c.render} color={c.color} />
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 6 }}>
        {lang === 'es' ? c.es.title : c.en.title}
      </div>
      <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.45 }}>
        {lang === 'es' ? c.es.sub : c.en.sub}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <CapVisual kind={c.render} color={c.color} />
      </div>
    </div>
  );
};

const CapGlyph = ({ kind, color }) => {
  const p = { width: 16, height: 16, stroke: color, fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'voice')  return <svg {...p} viewBox="0 0 20 20"><path d="M10 3v14M6 6v8M14 6v8M3 9v2M17 9v2"/></svg>;
  if (kind === 'vision') return <svg {...p} viewBox="0 0 20 20"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.5"/></svg>;
  if (kind === 'memory') return <svg {...p} viewBox="0 0 20 20"><circle cx="10" cy="10" r="6"/><path d="M10 6v4l3 2"/></svg>;
  if (kind === 'handoff')return <svg {...p} viewBox="0 0 20 20"><circle cx="6" cy="7" r="2.5"/><circle cx="14" cy="7" r="2.5"/><path d="M3 17a3 3 0 0 1 6 0M11 17a3 3 0 0 1 6 0"/></svg>;
  if (kind === 'lang')   return <svg {...p} viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7Z"/></svg>;
  if (kind === 'guard')  return <svg {...p} viewBox="0 0 20 20"><path d="M10 3 4 5v5c0 4 2.5 7 6 8 3.5-1 6-4 6-8V5l-6-2Z"/><path d="m7.5 10 2 2 3.5-4"/></svg>;
  return null;
};

// Per-capability micro-visual shown in the footer of each card
const CapVisual = ({ kind, color }) => {
  if (kind === 'voice') {
    // Animated waveform
    return (
      <div className="row gap-1" style={{ alignItems: 'center', height: 32 }}>
        {Array.from({ length: 22 }).map((_, i) => (
          <span key={i} style={{
            width: 3, borderRadius: 2, background: color,
            animation: `wave 1.1s ease-in-out ${i * 0.07}s infinite`,
            height: 10 + (i % 5) * 4,
          }} />
        ))}
      </div>
    );
  }
  if (kind === 'vision') {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-2)',
        background: 'var(--bg-sunk)', border: '1px solid var(--line)', borderRadius: 8,
        padding: 10, lineHeight: 1.5,
      }}>
        <div><span style={{ color: 'var(--ink-3)' }}>total:</span> <span style={{ color }}>€42,80</span></div>
        <div><span style={{ color: 'var(--ink-3)' }}>iva:</span> <span style={{ color }}>€7,48</span></div>
        <div><span style={{ color: 'var(--ink-3)' }}>nif:</span> <span style={{ color }}>B-8814…</span></div>
      </div>
    );
  }
  if (kind === 'memory') {
    return (
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {['sin gluten', 'mesa 12', 'blanco seco', '21:15'].map((t, i) => (
          <span key={i} style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 999,
            background: `color-mix(in oklch, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in oklch, ${color} 40%, transparent)`,
            color: 'var(--ink)',
          }}>{t}</span>
        ))}
      </div>
    );
  }
  if (kind === 'handoff') {
    return (
      <div className="row gap-2" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', alignItems: 'center' }}>
        <span style={{ padding: '3px 8px', borderRadius: 999, background: 'color-mix(in oklch, var(--ink) 8%, transparent)' }}>bot</span>
        <span>→</span>
        <span style={{ padding: '3px 8px', borderRadius: 999, background: `color-mix(in oklch, ${color} 18%, transparent)`, color }}>María · support</span>
      </div>
    );
  }
  if (kind === 'lang') {
    return (
      <div className="row gap-2" style={{ flexWrap: 'wrap', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
        {['es', 'en', 'ca', 'fr', 'pt', 'de', 'it', '+20'].map((t, i) => (
          <span key={i} style={{
            padding: '2px 7px', borderRadius: 6,
            background: i === 0 ? `color-mix(in oklch, ${color} 22%, transparent)` : 'var(--bg-sunk)',
            color: i === 0 ? color : 'var(--ink-3)',
            border: `1px solid ${i === 0 ? color : 'var(--line)'}`,
          }}>{t}</span>
        ))}
      </div>
    );
  }
  if (kind === 'guard') {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        <div style={{ color: 'var(--ink-3)' }}>✓ <span style={{ color }}>precio_valido</span></div>
        <div style={{ color: 'var(--ink-3)' }}>✓ <span style={{ color }}>stock_verificado</span></div>
        <div style={{ color: 'var(--ink-3)' }}>✗ <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>prometer_envío_hoy</span></div>
      </div>
    );
  }
  return null;
};

const CapabilityGallery = () => {
  const app = useApp();
  return (
    <div style={{ marginTop: 96 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: 'var(--accent-ink)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          {app.lang === 'es' ? 'No es solo chat' : 'Not just chat'}
        </div>
        <h3 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', letterSpacing: '-0.03em', fontWeight: 700, margin: 0, lineHeight: 1.1, fontFamily: 'var(--font-display)' }}>
          {app.lang === 'es' ? <>Seis capacidades que <em style={{ fontStyle: 'italic', fontWeight: 400 }}>van más allá</em>.</> : <>Six capabilities that <em style={{ fontStyle: 'italic', fontWeight: 400 }}>go further</em>.</>}
        </h3>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {CAPABILITIES.map(c => <CapCard key={c.k} c={c} lang={app.lang} />)}
      </div>
    </div>
  );
};
