"use client";

// Vista imprimible: una tarjeta QR por mesa. Genera los QRs como SVG
// inline con la lib `qrcode` en el cliente. Ctrl+P en el navegador
// produce un PDF/impresión A4 con 4-6 QRs por hoja según tamaño.

import * as React from "react";
import QRCode from "qrcode";

type TableRow = { number: string; zone: string | null };

export function PrintableQRs({
  tenantName,
  tenantSlug,
  baseUrl,
  tables,
}: {
  tenantName: string;
  tenantSlug: string;
  baseUrl: string;
  tables: TableRow[];
}) {
  const [qrDataUrls, setQrDataUrls] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const t of tables) {
        const url = `${baseUrl}/m/${tenantSlug}?mesa=${encodeURIComponent(t.number)}`;
        out[t.number] = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 512,
        });
      }
      setQrDataUrls(out);
    })();
  }, [tables, baseUrl, tenantSlug]);

  if (tables.length === 0) {
    return (
      <main className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-xl font-semibold">No hay mesas activas</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Añade mesas en <a href="/agent/tables" className="underline">/agent/tables</a>{" "}
          antes de imprimir los QRs.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white p-6 print:p-0">
      {/* Barra superior visible solo en pantalla (no imprime). */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            QRs imprimibles — {tenantName}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {tables.length} mesa{tables.length === 1 ? "" : "s"} activa{tables.length === 1 ? "" : "s"}.
            Pulsa el botón para imprimir o guardar como PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Imprimir / Guardar PDF
        </button>
      </div>

      {/* Grid de tarjetas QR. En impresión, 2 columnas A4 con tarjetas
          cuadradas tipo 9cm × 9cm. break-inside-avoid evita cortar
          una tarjeta entre páginas. */}
      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-3">
        {tables.map((t) => {
          const qr = qrDataUrls[t.number];
          return (
            <article
              key={t.number}
              className="flex flex-col items-center gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-center print:break-inside-avoid print:border-neutral-400"
            >
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                {tenantName}
              </div>
              <div className="text-3xl font-bold text-neutral-900">
                Mesa {t.number}
              </div>
              {t.zone && (
                <div className="text-xs text-neutral-500">{t.zone}</div>
              )}
              <div className="mt-1 flex h-52 w-52 items-center justify-center">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR mesa ${t.number}`} className="h-full w-full" />
                ) : (
                  <div className="text-xs text-neutral-400">Generando…</div>
                )}
              </div>
              <div className="text-[10px] text-neutral-400">
                Escanea para pedir desde tu móvil
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
