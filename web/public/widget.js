/*
 * Ordy Chat — widget embebible.
 * Uso en la web del tenant:
 *   <script src="https://ordychat.ordysuite.com/widget.js" data-tenant="SLUG" async></script>
 *
 * Pinta un botón flotante bottom-right. Al click abre un iframe con
 * /chat/{slug}. Sin dependencias, ~2KB.
 */
(function () {
  "use strict";

  if (window.__ordyChatLoaded) return;
  window.__ordyChatLoaded = true;

  var script = document.currentScript;
  if (!script) return;

  var slug = (script.getAttribute("data-tenant") || "").trim();
  if (!slug) {
    console.error("[ordychat] missing data-tenant attribute");
    return;
  }

  var origin = new URL(script.src).origin;
  var chatUrl = origin + "/chat/" + encodeURIComponent(slug);
  var brandColor = script.getAttribute("data-color") || "#10b981";
  var greeting = script.getAttribute("data-greeting") || "¿Hablamos?";

  // ---------- Styles ----------
  var css = [
    ".ordy-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483645;display:flex;align-items:center;gap:10px;cursor:pointer;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none}",
    ".ordy-launcher-btn{width:60px;height:60px;border-radius:50%;background:" + brandColor + ";display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:transform .15s}",
    ".ordy-launcher:hover .ordy-launcher-btn{transform:scale(1.05)}",
    ".ordy-launcher-bubble{background:#fff;color:#222;padding:8px 14px;border-radius:18px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.1);max-width:200px}",
    ".ordy-frame-wrap{position:fixed;right:20px;bottom:20px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);z-index:2147483646;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);background:#000;display:none}",
    ".ordy-frame-wrap.open{display:block}",
    ".ordy-frame-wrap iframe{border:0;width:100%;height:100%;display:block}",
    ".ordy-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;line-height:1;z-index:1;border:0}",
    "@media (max-width:480px){.ordy-frame-wrap{right:0;bottom:0;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border-radius:0}.ordy-launcher-bubble{display:none}}",
  ].join("\n");

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Launcher ----------
  var launcher = document.createElement("div");
  launcher.className = "ordy-launcher";
  launcher.setAttribute("role", "button");
  launcher.setAttribute("aria-label", "Abrir chat");
  launcher.innerHTML =
    '<div class="ordy-launcher-bubble">' + escapeHtml(greeting) + "</div>" +
    '<div class="ordy-launcher-btn" aria-hidden="true">' +
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    "</div>";

  // ---------- Frame ----------
  var frameWrap = document.createElement("div");
  frameWrap.className = "ordy-frame-wrap";
  frameWrap.innerHTML =
    '<button class="ordy-close" aria-label="Cerrar chat">×</button>' +
    '<iframe title="Chat" loading="lazy" allow="clipboard-write"></iframe>';

  var iframe = frameWrap.querySelector("iframe");
  var closeBtn = frameWrap.querySelector(".ordy-close");

  function open() {
    if (!iframe.src) iframe.src = chatUrl;
    frameWrap.classList.add("open");
    launcher.style.display = "none";
  }
  function close() {
    frameWrap.classList.remove("open");
    launcher.style.display = "";
  }

  launcher.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  document.body.appendChild(launcher);
  document.body.appendChild(frameWrap);

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      );
    });
  }
})();
