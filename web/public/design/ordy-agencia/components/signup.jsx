/* Ordy-AgencIA — Signup flow */

const Signup = ({ onNav, onComplete }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const [step, setStep] = React.useState(1);
  const [data, setData] = React.useState({
    email: '', password: '', company: '', niche: '', size: '',
  });
  const update = (k, v) => setData(d => ({ ...d, [k]: v }));

  const niches = ['E-commerce', 'Salud', 'Legal', 'Educación', 'Inmobiliaria', 'Hostelería', 'Logística', 'Finanzas', 'Otro'];
  const sizes = ['Solo yo', '2–5', '6–20', '21–100', '100+'];

  const canContinue =
    (step === 1 && data.email.includes('@') && data.password.length >= 6) ||
    (step === 2 && data.company.length > 1) ||
    (step === 3 && data.niche && data.size);

  const next = () => {
    if (step < 3) setStep(step + 1);
    else onComplete(data);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left panel — marketing */}
      <div style={{
        background: 'var(--ink)',
        color: 'var(--bg)',
        padding: '48px 56px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-20%',
          width: 500, height: 500, borderRadius: '50%',
          background: 'var(--accent)',
          opacity: 0.18, filter: 'blur(60px)',
        }} />
        <div style={{ position: 'relative' }}>
          <Logo size={26} />
        </div>
        <div style={{ marginTop: 'auto', position: 'relative', maxWidth: 480 }}>
          <div className="caps" style={{ color: 'oklch(0.85 0.09 var(--accent-h))', marginBottom: 24 }}>
            {app.lang === 'es' ? 'Bienvenida' : 'Welcome'}
          </div>
          <h1 className="display" style={{ fontSize: 54, margin: '0 0 24px', lineHeight: 1.05, fontWeight: 400 }}>
            {app.lang === 'es'
              ? <>Una agencia de IA <span style={{ fontStyle: 'italic', color: 'oklch(0.85 0.09 var(--accent-h))' }}>lista en 10 minutos.</span></>
              : <>An AI agency <span style={{ fontStyle: 'italic', color: 'oklch(0.85 0.09 var(--accent-h))' }}>ready in 10 minutes.</span></>}
          </h1>
          <p style={{ fontSize: 16, color: 'oklch(0.82 0.01 80)', marginBottom: 40 }}>
            {app.lang === 'es'
              ? 'Tu workspace se provisiona mientras te registras. Plantilla base, dominio de prueba y primer agente listos.'
              : 'Your workspace provisions while you sign up. Base template, trial domain and first agent — ready.'}
          </p>
          <div className="col gap-3">
            {[
              app.lang === 'es' ? '14 días de prueba, todos los plan features' : '14-day trial, all plan features',
              app.lang === 'es' ? 'Sin tarjeta de crédito' : 'No credit card required',
              app.lang === 'es' ? 'Traslado de datos gratuito' : 'Free data migration',
            ].map(x => (
              <div key={x} className="row gap-2" style={{ fontSize: 14, color: 'oklch(0.88 0.01 80)' }}>
                <span style={{ color: 'oklch(0.85 0.09 var(--accent-h))' }}><Icon name="check" size={14} /></span>
                {x}
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 64, position: 'relative', fontSize: 12, color: 'oklch(0.65 0 0)' }} className="mono">
          © Ordy-AgencIA · SOC2 · GDPR · ISO 27001
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{ padding: '48px 56px', display: 'flex', flexDirection: 'column' }}>
        <div className="row between">
          <button className="btn btn-link" onClick={() => step === 1 ? onNav('landing') : setStep(step - 1)}>
            {t.signup_back}
          </button>
          <div className="row gap-2" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            <span className="mono">{t.signup_step} {step} {t.signup_of} 3</span>
            <div className="row gap-1">
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  width: 22, height: 3, borderRadius: 2,
                  background: i <= step ? 'var(--accent)' : 'var(--line-strong)',
                }} />
              ))}
            </div>
          </div>
        </div>

        <div style={{ margin: 'auto 0', maxWidth: 420, width: '100%' }} className="fade-in" key={step}>
          <h2 className="display" style={{ fontSize: 42, margin: '0 0 12px', fontWeight: 400 }}>
            {step === 1 && (app.lang === 'es' ? 'Crea tu cuenta' : 'Create your account')}
            {step === 2 && (app.lang === 'es' ? 'Nombra tu agencia' : 'Name your agency')}
            {step === 3 && (app.lang === 'es' ? 'Cuéntanos un poco más' : 'Tell us a bit more')}
          </h2>
          <p style={{ color: 'var(--ink-3)', margin: '0 0 32px' }}>
            {step === 1 && t.signup_sub}
            {step === 2 && (app.lang === 'es' ? 'Así aparecerá en tu dominio y facturación.' : 'This appears on your domain and invoices.')}
            {step === 3 && (app.lang === 'es' ? 'Personalizamos tus plantillas en base a esto.' : 'We tailor your templates based on this.')}
          </p>

          {step === 1 && (
            <div className="col gap-4">
              <div>
                <label className="label">{t.signup_email}</label>
                <input className="input" type="email" placeholder="tu@agencia.com" value={data.email} onChange={e => update('email', e.target.value)} />
              </div>
              <div>
                <label className="label">{t.signup_password}</label>
                <input className="input" type="password" placeholder="••••••••" value={data.password} onChange={e => update('password', e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }} className="mono">MIN. 6 CARACTERES</div>
              </div>
              <div style={{ position: 'relative', textAlign: 'center', margin: '8px 0' }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--line)' }} />
                <span style={{ position: 'relative', background: 'var(--bg)', padding: '0 12px', fontSize: 11, color: 'var(--ink-3)' }} className="caps">
                  {app.lang === 'es' ? 'O continúa con' : 'Or continue with'}
                </span>
              </div>
              <div className="row gap-2">
                {['Google', 'GitHub', 'Microsoft'].map(p => (
                  <button key={p} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>{p}</button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="col gap-4">
              <div>
                <label className="label">{t.signup_company}</label>
                <input className="input" placeholder="Norte Digital, Helix Labs…" value={data.company} onChange={e => update('company', e.target.value)} />
              </div>
              <div>
                <label className="label">{app.lang === 'es' ? 'Tu subdominio' : 'Your subdomain'}</label>
                <div className="row" style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <input
                    className="input"
                    style={{ border: 'none', borderRadius: 0 }}
                    placeholder="miagencia"
                    value={(data.company || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '').slice(0, 20)}
                    readOnly
                  />
                  <div style={{ padding: '10px 14px', background: 'var(--bg-elev)', color: 'var(--ink-3)', fontSize: 13, borderLeft: '1px solid var(--line)' }} className="mono">
                    .ordy.ai
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--accent-ink)', marginTop: 8 }}>
                  <Icon name="check" size={10} /> {app.lang === 'es' ? 'DISPONIBLE' : 'AVAILABLE'}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="col gap-5">
              <div>
                <label className="label">{t.signup_niche}</label>
                <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {niches.map(n => (
                    <button
                      key={n}
                      onClick={() => update('niche', n)}
                      className="btn"
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        borderRadius: 999,
                        border: '1px solid',
                        borderColor: data.niche === n ? 'var(--ink)' : 'var(--line-strong)',
                        background: data.niche === n ? 'var(--ink)' : 'var(--bg-card)',
                        color: data.niche === n ? 'var(--bg)' : 'var(--ink-2)',
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">{t.signup_size}</label>
                <div className="row gap-2">
                  {sizes.map(s => (
                    <button
                      key={s}
                      onClick={() => update('size', s)}
                      className="btn"
                      style={{
                        flex: 1, justifyContent: 'center',
                        padding: '10px 8px',
                        fontSize: 13,
                        border: '1px solid',
                        borderColor: data.size === s ? 'var(--ink)' : 'var(--line-strong)',
                        background: data.size === s ? 'var(--bg-elev)' : 'var(--bg-card)',
                        color: 'var(--ink)',
                      }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={next}
            disabled={!canContinue}
            style={{
              width: '100%', justifyContent: 'center',
              padding: '14px', fontSize: 14, marginTop: 32,
              opacity: canContinue ? 1 : 0.4, cursor: canContinue ? 'pointer' : 'not-allowed',
            }}
          >
            {step === 3 ? t.signup_finish : t.signup_continue} <Icon name="arrow_right" size={14} />
          </button>

          {step === 1 && (
            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--ink-3)' }}>
              {t.signup_has_account} <a onClick={() => onNav('dashboard')} style={{ color: 'var(--ink)', textDecoration: 'underline', cursor: 'pointer' }}>{t.signup_login}</a>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--ink-4)' }} className="mono">
          AES-256 · TLS 1.3 · HUMAN ONLY
        </div>
      </div>
    </div>
  );
};

window.Signup = Signup;
