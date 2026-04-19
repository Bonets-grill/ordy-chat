/* ordy-system/theme.js
 * Runtime branding helpers. Consumed by any product HTML.
 *
 * Usage:
 *   script src="ordy-system/theme.js"
 *   OrdySystem.applyBrand({ name: 'Clinnia', accentH: 180, ... })
 */
(function (global) {
  const DEFAULT_BRAND = {
    id: 'ordy',
    name: 'Ordy·AgencIA',
    logoGlyph: 'ø',
    tagline: 'Infraestructura para agencias de IA.',
    accentH: 320,          // hue rotation for accent color (0-360)
    theme: 'dark',         // 'light' | 'dark'
    lang: 'es',            // 'es' | 'en'
    density: 'normal',     // 'compact' | 'normal' | 'spacious'
    fontDisplay: "'Instrument Serif', Georgia, serif",
    fontUi: "'Inter', system-ui, sans-serif",
    fontMono: "'JetBrains Mono', Menlo, monospace",
    neonHues: [320, 40, 200], // 3 hues that rotate around the prompt box
    // Copy overrides — merged into I18N[lang] at runtime
    copy: null,
    // Vertical config: what tabs/niches appear in the hero
    nicheTabs: null,
  };

  function applyBrand(brand) {
    const b = Object.assign({}, DEFAULT_BRAND, brand || {});
    const root = document.documentElement;
    root.setAttribute('data-theme', b.theme);
    root.style.setProperty('--accent-h', b.accentH);
    root.style.setProperty('--font-display', b.fontDisplay);
    root.style.setProperty('--font-ui', b.fontUi);
    root.style.setProperty('--font-mono', b.fontMono);
    const dens = { compact: 0.85, normal: 1, spacious: 1.15 }[b.density] || 1;
    root.style.setProperty('--density', dens);
    document.title = b.name + ' · ' + (b.tagline || '');
    global.__ORDY_BRAND__ = b;
    return b;
  }

  // Called by components to read current brand (set before App mounts)
  function brand() { return global.__ORDY_BRAND__ || DEFAULT_BRAND; }

  global.OrdySystem = { applyBrand, brand, DEFAULT_BRAND };
})(window);
