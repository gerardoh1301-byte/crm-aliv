/*
 * Captura de formularios EasySell abandonados — Aliv Perú.
 *
 * Se carga en el tema de Shopify con UNA línea (antes de </body> en theme.liquid):
 *   <script src="https://crm-aliv.onrender.com/js/captura-formulario.js" defer></script>
 *
 * Cuando el cliente escribe un celular válido en el formulario (#es-form) y no lo envía,
 * manda nombre, celular, ciudad, dirección, producto y total al CRM, que le escribe por
 * WhatsApp a los 30 minutos si no compró. No guarda nada en el navegador ni usa cookies.
 */
(function () {
  "use strict";
  if (window.__alivCaptura) return;
  window.__alivCaptura = true;

  var script = document.currentScript;
  var BASE = script && script.src ? new URL(script.src).origin : "https://crm-aliv.onrender.com";
  var ENDPOINT = BASE + "/api/webhooks/formulario-abandonado";
  var CAMPOS = { "es-phone": 1, "es-first_name": 1, "es-city": 1, "es-address": 1 };
  var ultimoEnviado = "";
  var ultimoEnvioMs = 0;
  var enviado = false; // el cliente pulsó "comprar": ya no es abandono
  var temporizador = null;

  function val(id) {
    var el = document.getElementById(id);
    return el && typeof el.value === "string" ? el.value.trim() : "";
  }

  function celularValido(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("51") === 0 && d.length === 11) d = d.slice(2);
    return d.length === 9 && d.charAt(0) === "9" ? d : "";
  }

  function totalDelFormulario() {
    var form = document.getElementById("es-form");
    if (!form) return "";
    var txt = form.innerText || "";
    var m = txt.match(/Total\s*S\/\.?\s*([\d.,]+)/gi);
    if (!m || !m.length) return "";
    var ultimo = m[m.length - 1].match(/([\d.,]+)\s*$/);
    return ultimo ? ultimo[1].replace(",", ".") : "";
  }

  function producto() {
    var og = document.querySelector('meta[property="og:title"]');
    return (og && og.content) || document.title || "";
  }

  function datos() {
    return {
      telefono: celularValido(val("es-phone")),
      nombre: val("es-first_name"),
      ciudad: val("es-city"),
      direccion: val("es-address"),
      producto: producto(),
      total: totalDelFormulario(),
      url: location.origin + location.pathname,
      web: "",
    };
  }

  function enviar(usarBeacon) {
    if (enviado) return;
    var d = datos();
    if (!d.telefono) return;
    var cuerpo = JSON.stringify(d);
    if (cuerpo === ultimoEnviado) return;
    // Máximo un envío cada 15 s mientras escribe (el último cambio sale al salir de la página).
    if (!usarBeacon && Date.now() - ultimoEnvioMs < 15000 && ultimoEnviado) return;
    ultimoEnviado = cuerpo;
    ultimoEnvioMs = Date.now();
    try {
      if (usarBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([cuerpo], { type: "text/plain" }));
        return;
      }
      fetch(ENDPOINT, {
        method: "POST",
        mode: "cors",
        keepalive: true,
        headers: { "content-type": "text/plain" },
        body: cuerpo,
      }).catch(function () {});
    } catch {
      /* nunca romper la tienda */
    }
  }

  function programar() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(function () {
      enviar(false);
    }, 2000);
  }

  function avisoPrivacidad() {
    var tel = document.getElementById("es-phone");
    if (!tel || document.getElementById("aliv-aviso-wsp")) return;
    var p = document.createElement("div");
    p.id = "aliv-aviso-wsp";
    p.textContent = "Te escribiremos por WhatsApp solo para ayudarte con este pedido.";
    p.style.cssText = "font-size:11px;color:#6b7280;margin:4px 2px 0;line-height:1.3";
    var contenedor = tel.parentElement && tel.parentElement.parentElement ? tel.parentElement.parentElement : tel.parentElement;
    if (contenedor) contenedor.appendChild(p);
  }

  document.addEventListener(
    "input",
    function (e) {
      var t = e.target;
      if (t && CAMPOS[t.id]) {
        avisoPrivacidad();
        programar();
      }
    },
    true
  );
  document.addEventListener(
    "focusin",
    function (e) {
      if (e.target && e.target.id === "es-phone") avisoPrivacidad();
    },
    true
  );
  document.addEventListener(
    "click",
    function (e) {
      var b = e.target && e.target.closest ? e.target.closest('#es-form button, #es-form [type="submit"]') : null;
      if (b && /comprar|pedido|completar|confirmar|ordenar|pagar/i.test(b.innerText || b.value || "")) {
        enviado = true;
      }
    },
    true
  );
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") enviar(true);
  });
  window.addEventListener("pagehide", function () {
    enviar(true);
  });
})();
