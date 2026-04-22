// Renderiza texto de mensaje (cliente o bot) con URLs convertidas a enlaces
// clickables, estilados y con dominio limpio. Comparte UX entre playground
// (/dashboard/playground) y conversations real (/conversations/[id]).
//
// Detalles deliberados:
// - Regex captura https?://… hasta el primer whitespace o paréntesis.
// - Strip de puntuación trailing (. , ) ! ? ; :) — la puntuación final del
//   párrafo NO es parte del URL.
// - El display text es host + path corto (más legible que el slug crudo).
// - target=_blank + rel="noopener noreferrer" por seguridad XSS.
// - whitespace-pre-wrap respeta saltos del LLM. break-words evita overflow.

import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;

function splitTrailingPunct(raw: string): { url: string; trailing: string } {
  const m = raw.match(TRAILING_PUNCT_RE);
  if (!m) return { url: raw, trailing: "" };
  const trailing = m[0];
  return { url: raw.slice(0, -trailing.length), trailing };
}

function prettyDisplay(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const pathAndQuery = (u.pathname === "/" ? "" : u.pathname) + (u.search || "");
    if (!pathAndQuery) return host;
    if (pathAndQuery.length <= 22) return host + pathAndQuery;
    return host + pathAndQuery.slice(0, 18) + "…";
  } catch {
    // Si new URL falla, devolvemos el raw — mejor que romper.
    return url;
  }
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block h-3 w-3 shrink-0"
      aria-hidden="true"
    >
      <path d="M9 3h4v4" />
      <path d="M13 3 7.5 8.5" />
      <path d="M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7" />
    </svg>
  );
}

export function MessageContent({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const { url, trailing } = splitTrailingPunct(part);
      nodes.push(
        <a
          key={`a-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 break-all rounded-md bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700 underline decoration-blue-400/60 underline-offset-2 transition-colors hover:bg-blue-100 hover:text-blue-800 hover:decoration-blue-700"
        >
          <span className="truncate">{prettyDisplay(url)}</span>
          <ExternalLinkIcon />
        </a>,
      );
      if (trailing) nodes.push(<span key={`p-${i}`}>{trailing}</span>);
    } else if (part.length > 0) {
      nodes.push(<span key={`t-${i}`}>{part}</span>);
    }
  });
  return <div className={`whitespace-pre-wrap break-words ${className ?? ""}`}>{nodes}</div>;
}
