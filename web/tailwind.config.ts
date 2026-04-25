import type { Config } from "tailwindcss";

// Tokens "Claude Design" — paneles internos.
// La landing pública NO usa estos tokens; sigue con el look anterior
// vía sus propias clases utilitarias y gradientes (hero, neon-wrap, etc.).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand del tenant — cálido tipo Claude (terracotta editorial).
        // Ya no es violet puro; el violet queda reservado para super-admin
        // como elemento diferenciador.
        brand: {
          50: "#fdf6f3",
          100: "#fbe9e1",
          200: "#f5cbb9",
          300: "#eda88d",
          400: "#dd7e5b",
          500: "#c96442",
          600: "#b35438",
          700: "#8e4029",
          800: "#6b3220",
          900: "#4a231a",
        },
        // Acentos generales (mantengo pink/orange para retrocompatibilidad
        // con landing/hero existentes).
        accent: {
          pink: "#ec4899",
          orange: "#f97316",
        },
        // Superficies cálidas, NO blanco puro. Da identidad "parchment Claude".
        surface: {
          DEFAULT: "#fdfdfc",       // base de página
          subtle: "#fafaf9",         // wash de body
          muted: "#f5f4ed",          // bloques destacados
          card: "#ffffff",           // tarjetas (siguen blancas para contraste)
        },
        // Borders en 2 niveles — el sutil casi imperceptible, el strong para hover/focus.
        border: {
          DEFAULT: "rgba(0, 0, 0, 0.06)",
          subtle: "rgba(0, 0, 0, 0.06)",
          strong: "rgba(0, 0, 0, 0.10)",
        },
        // Tinta — jerarquía de 4 niveles para textos.
        ink: {
          DEFAULT: "#0a0a0a",        // títulos H1, números grandes
          900: "#0a0a0a",
          700: "#262626",            // body alto contraste
          500: "#737373",            // texto secundario
          400: "#a3a3a3",            // muted, captions
          300: "#d4d4d4",            // disabled
        },
        // Semánticos — tonos refinados, claros + dark para texto sobre fondo claro.
        success: {
          DEFAULT: "#10b981",
          50: "#ecfdf5",
          100: "#d1fae5",
          600: "#059669",
          700: "#047857",
        },
        warn: {
          DEFAULT: "#f59e0b",
          50: "#fffbeb",
          100: "#fef3c7",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
        },
        danger: {
          DEFAULT: "#ef4444",
          50: "#fef2f2",
          100: "#fee2e2",
          600: "#dc2626",
          700: "#b91c1c",
        },
        info: {
          DEFAULT: "#3b82f6",
          50: "#eff6ff",
          100: "#dbeafe",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        // WhatsApp accent — para chips/pills WA.
        wa: {
          DEFAULT: "#25d366",
          50: "#ecfdf5",
          600: "#1cb555",
        },
        // Violet — super-admin diferenciador.
        violet: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          900: "#4c1d95",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "system-ui",
          "ui-sans-serif",
          "Helvetica Neue",
          "sans-serif",
        ],
        // Serif editorial estilo Claude para H1 grandes / portadas / hero internos.
        serif: [
          "Charter",
          "Iowan Old Style",
          "Palatino",
          "Palatino Linotype",
          "Georgia",
          "Times New Roman",
          "serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Cascadia Code",
          "Roboto Mono",
          "Liberation Mono",
          "monospace",
        ],
      },
      letterSpacing: {
        "tight-h1": "-0.02em",
        comfortable: "0.01em",
        wider2: "0.08em",
      },
      borderRadius: {
        // Defaults: cards xl (12px), inputs/buttons md (6px), pills full.
        lg: "0.625rem",   // 10px
        xl: "0.75rem",    // 12px
        "2xl": "1rem",    // 16px
      },
      boxShadow: {
        // Sombras refinadas — casi imperceptible para cards, sólo menus levantan.
        sm: "0 1px 2px 0 rgba(15, 14, 10, 0.04)",
        md: "0 4px 12px -2px rgba(15, 14, 10, 0.06), 0 2px 4px -2px rgba(15, 14, 10, 0.04)",
        lg: "0 10px 24px -4px rgba(15, 14, 10, 0.10), 0 4px 8px -4px rgba(15, 14, 10, 0.06)",
        // Ring shadow estilo Claude (inset 1px) para cards sin border duro.
        ringSubtle: "inset 0 0 0 1px rgba(0, 0, 0, 0.06)",
        ringStrong: "inset 0 0 0 1px rgba(0, 0, 0, 0.10)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "48px 48px",
      },
      animation: {
        "pulse-soft": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-slide": "fadeSlide 220ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
