# Ordy Design System

Sistema de diseño compartido para productos tipo agencia-de-agentes-IA.

## Archivos

- `ordy-system.css` — tokens, botones, inputs, cards, animaciones, neon border
- `theme.js` — helper runtime para aplicar branding (acento, tema, idioma, fuentes)
- `blocks/*.jsx` — 7 bloques React: shared, landing, waiter_demo, signup, dashboard, builder, app_root

## Crear un producto nuevo

1. Crea `MiProducto.html` en la raíz
2. Copia la estructura de `Ordy-AgencIA.html`, pero importa el CSS/JSX desde `ordy-system/`:

```html
<link rel="stylesheet" href="ordy-system/ordy-system.css">
<script src="ordy-system/theme.js"></script>
<script>
  OrdySystem.applyBrand({
    id: 'clinnia',
    name: 'Clinnia',
    logoGlyph: '✚',
    accentH: 180,           // cyan
    neonHues: [180, 220, 320],
    tagline: 'Agentes IA para clínicas',
    copy: { /* overrides de I18N */ },
  });
</script>
```

3. Carga los bloques JSX en orden:
   - `shared.jsx` → `landing.jsx` → `waiter_demo.jsx` → `signup.jsx` → `dashboard.jsx` → `builder.jsx` → `app_root.jsx`

## Tokens clave (ajustables por producto)

| Variable           | Qué controla                               |
|--------------------|---------------------------------------------|
| `--accent-h`       | Hue del color de acento (0–360)             |
| `--font-display`   | Tipografía serif editorial                  |
| `--font-ui`        | Tipografía UI                               |
| `--density`        | Compactación (0.85 / 1 / 1.15)              |
| `data-theme`       | `light` o `dark`                            |

## Componentes reutilizables

- `Nav`, `PromptHero` con pill tabs, `LogoStrip`, `FeatureShowcase`, `Stats`, `UseCases`, `Pricing`, `CTA`, `Footer`
- `WaiterDemo` (chat + grafo de nodos n8n-style con data packets)
- `CapabilityGallery` (6 capacidades con micro-animaciones)
- `Signup` (multi-step)
- `Dashboard`, `Builder`

Cualquiera puede especializarse por producto sobreescribiendo el objeto de copy o el layout de nodos.
