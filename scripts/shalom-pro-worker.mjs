/**
 * Worker Playwright (Opción A) — Flujo Automatizado Shalom PRO → Drive → CRM → AliClik (WANKLIC GROUP 2) → Alerta Supervisores
 *
 * Uso:
 *   node scripts/shalom-pro-worker.mjs --once       (procesa pedidos listos una sola vez)
 *   node scripts/shalom-pro-worker.mjs --watch      (vigila cada 60s pedidos en etapa adelanto_pagado)
 *   node scripts/shalom-pro-worker.mjs --dry-run    (solo lista pedidos listos/incompletos sin crear envíos)
 *   node scripts/shalom-pro-worker.mjs --login      (abre Chrome con perfil persistente para iniciar sesión en pro.shalom.pe)
 *
 * Variables opcionales en .env.local:
 *   SHALOM_PRO_EMAIL=alivperu1301@gmail.com
 *   SHALOM_PRO_PASSWORD=...
 *   SHALOM_PREGUIAS_DRIVE_FOLDER_ID=1nh0aCCxClBGBaB4Z1NNEmBQVp-hKa1nH
 *   CRM_BASE_URL=https://crm-aliv.onrender.com
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

function cargarEnvLocal() {
  const envPath = path.join(ROOT_DIR, ".env.local");
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) {
        env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  return env;
}

const ENV = cargarEnvLocal();
const CRM_BASE_URL = (ENV.CRM_BASE_URL || "https://crm-aliv.onrender.com").replace(/\/$/, "");
const WORKER_SECRET = ENV.AGENT_WORKER_SECRET || "";
const DRIVE_FOLDER_ID = ENV.SHALOM_PREGUIAS_DRIVE_FOLDER_ID || "1nh0aCCxClBGBaB4Z1NNEmBQVp-hKa1nH";
const PROFILE_DIR = path.join(ROOT_DIR, ".local", "shalom-pro-chrome-profile");
const DOWNLOADS_DIR = path.join(ROOT_DIR, ".local", "shalom-preguias");

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const WATCH = ARGS.has("--watch");
const LOGIN_ONLY = ARGS.has("--login");

fs.mkdirSync(PROFILE_DIR, { recursive: true });
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function dividirNombreCompleto(nombreCompleto) {
  const partes = String(nombreCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 1) return { nombre: partes[0], paterno: partes[0], materno: "" };
  if (partes.length === 2) return { nombre: partes[0], paterno: partes[1], materno: "" };
  if (partes.length === 3) return { nombre: partes[0], paterno: partes[1], materno: partes[2] };
  return {
    nombre: partes.slice(0, partes.length - 2).join(" "),
    paterno: partes[partes.length - 2],
    materno: partes[partes.length - 1],
  };
}

function subirADriveConCli(filePath, fileName, folderId) {
  try {
    // Usa el CLI oficial conectado `gdrive` (cuenta gerardoh1301@gmail.com)
    // El archivo ya está renombrado con `fileName` en `filePath`
    const out = execFileSync(
      "gdrive",
      [
        "mutate",
        "upload",
        filePath,
        "--parent",
        folderId,
        "--mime-type",
        "application/pdf",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000, shell: process.platform === "win32" }
    );
    let fileId = null;
    try {
      const parsed = JSON.parse(out);
      fileId = parsed?.id || parsed?.file?.id || null;
    } catch {
      const idMatch = out.match(/[a-zA-Z0-9_-]{25,}/);
      fileId = idMatch ? idMatch[0] : null;
    }
    const fileUrl = fileId
      ? `https://drive.google.com/file/d/${fileId}/view`
      : `https://drive.google.com/drive/folders/${folderId}`;
    console.log(`[Drive] ✅ Subido a preguias shalom: ${fileName} -> ${fileUrl}`);
    return { ok: true, fileUrl };
  } catch (err) {
    console.warn(`[Drive] ⚠️ No se pudo subir por CLI gdrive (archivo guardado localmente en ${filePath}):`, err.message);
    return { ok: false, fileUrl: `https://drive.google.com/drive/folders/${folderId}` };
  }
}

async function obtenerPendientesCrm() {
  if (!WORKER_SECRET) {
    throw new Error("Falta AGENT_WORKER_SECRET en .env.local");
  }
  const res = await fetch(`${CRM_BASE_URL}/api/shalom-pro/pendientes`, {
    headers: { authorization: `Bearer ${WORKER_SECRET}` },
  });
  if (!res.ok) {
    throw new Error(`Error consultando pendientes CRM (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function completarEnCrm(payload) {
  const res = await fetch(`${CRM_BASE_URL}/api/shalom-pro/completar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Error completando en CRM (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function abrirNavegador() {
  const { chromium } = await import("playwright-core");
  const chromePath =
    ENV.CHROME_EXECUTABLE_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const launchOpts = {
    headless: false, // Visible para que nunca se bloquee por sesión/verificación humana
    acceptDownloads: true,
    viewport: { width: 1366, height: 820 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
    ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : { channel: "chrome" }),
  };
  return chromium.launchPersistentContext(PROFILE_DIR, launchOpts);
}

async function asegurarSesionShalomPro(page) {
  await page.goto("https://pro.shalom.pe/home", { waitUntil: "networkidle", timeout: 45_000 });
  if (page.url().includes("/login")) {
    console.log("[Shalom PRO] Sesión no iniciada. Intentando login...");
    const email = ENV.SHALOM_PRO_EMAIL || "alivperu1301@gmail.com";
    const password = ENV.SHALOM_PRO_PASSWORD || "";
    if (email && password) {
      await page.fill('input[type="email"], input[placeholder*="correo" i], input[name*="email" i]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button:has-text("Iniciar sesión")');
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });
    } else {
      console.log("[Shalom PRO] ⏸️ Inicia sesión manualmente en la ventana de Chrome (máx. 2 min)...");
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 120_000 });
    }
  }
  console.log("[Shalom PRO] ✅ Sesión activa en:", page.url());
}

/**
 * Ejecuta los pasos exactos de Shalom PRO (capturas 3 -> 10) para un pedido.
 */
async function registrarEnvioEnShalomPro(page, pedido) {
  console.log(`\n[Shalom PRO] 🚀 Procesando ${pedido.numeroOrden} · ${pedido.clienteNombre} (DNI ${pedido.clienteDni}) -> ${pedido.agenciaShalomDestino}`);

  // Paso 1: Ir a Home y hacer clic en "Registra"
  await page.goto("https://pro.shalom.pe/home", { waitUntil: "networkidle", timeout: 45_000 });
  await page.locator('text="Registra"').first().click();
  await page.waitForTimeout(1200);

  // Paso 2: Elegir "Caja Paquete XS" y Continuar
  await page.locator('text=/Caja Paquete XS/i').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(1200);

  // Paso 3: Origen fijo = Lima, Lima, La Victoria, Raymondi | Destino = agencia localizada por el bot
  const origenInput = page.locator('input[placeholder*="Origen" i], [aria-label*="Origen" i]').first();
  if (await origenInput.count()) {
    await origenInput.click();
    await origenInput.fill("Raymondi");
    await page.waitForTimeout(800);
    await page.locator('text=/La Victoria.*Raymondi|Raymondi/i').first().click();
  }
  await page.waitForTimeout(600);

  const destinoInput = page.locator('input[placeholder*="Destino" i], [aria-label*="Destino" i]').first();
  if (await destinoInput.count()) {
    await destinoInput.click();
    // Usar las palabras más distintivas de la agencia destino
    const terminoBusqueda = pedido.agenciaShalomDestino.split(/[-,/]/)[0].trim().slice(0, 30);
    await destinoInput.fill(terminoBusqueda);
    await page.waitForTimeout(1000);
    await page.locator('[role="option"], li, .option').first().click();
  }
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(1200);

  // Paso 4: Envío Sobreprotegido -> dejar "No deseo el servicio" y Continuar
  const noDeseoSobre = page.locator('text=/No deseo el servicio/i').first();
  if (await noDeseoSobre.count()) {
    // Ya viene marcado por defecto en rojo, solo confirmamos continuar
  }
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(1200);

  // Paso 5: Destinatario -> DNI + autocompletar o llenar nombre/apellidos + celular
  const dniInput = page.locator('input[placeholder*="DNI" i]').first();
  await dniInput.click();
  await dniInput.fill(pedido.clienteDni);
  await dniInput.press("Tab");
  await page.waitForTimeout(1500);

  const nombreInput = page.locator('input[placeholder="Nombre"]').first();
  if ((await nombreInput.count()) && !(await nombreInput.inputValue()).trim()) {
    const { nombre, paterno, materno } = dividirNombreCompleto(pedido.clienteNombre);
    await nombreInput.fill(nombre);
    const patInput = page.locator('input[placeholder*="Apellido paterno" i]').first();
    if (await patInput.count()) await patInput.fill(paterno);
    const matInput = page.locator('input[placeholder*="Apellido materno" i]').first();
    if ((await matInput.count()) && materno) await matInput.fill(materno);
  }
  const celInput = page.locator('input[placeholder*="Celular" i]').first();
  if ((await celInput.count()) && !(await celInput.inputValue()).trim()) {
    const cel9 = pedido.clienteTelefono.slice(-9);
    await celInput.fill(cel9);
  }
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(1200);

  // Paso 6: Servicio de Cobros Seguros -> dejar "No deseo el servicio" y Continuar
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(1200);

  // Paso 7: Clave de Seguridad (teclado digital aleatorio de 4 dígitos)
  const clave = String(pedido.claveRetiroSugerida);
  for (const digito of clave) {
    // Cada botón del teclado numérico muestra exactamente 1 dígito (0..9)
    await page.locator(`button:text-is("${digito}")`).first().click();
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Continuar")').first().click();
  await page.waitForTimeout(2500);

  // Paso 8: Capturar N° de registro (ej. "V243 - 104493206") y Descargar rótulo PDF
  const bodyText = await page.locator("body").innerText();
  const matchReg = bodyText.match(/([A-Z0-9]{4})\s*-\s*(\d{7,12})/);
  if (!matchReg) {
    throw new Error("No se detectó el N° de registro Shalom en pantalla tras confirmar la clave.");
  }
  const codigoShalom = matchReg[1].trim().toUpperCase();
  const numeroOrdenShalom = matchReg[2].trim();
  console.log(`[Shalom PRO] ✅ Registro confirmado: Código=${codigoShalom} · N° Orden=${numeroOrdenShalom} · Clave=${clave}`);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.locator('button:has-text("Descargar rótulo"), a:has-text("Descargar rótulo")').first().click();
  const download = await downloadPromise;

  const destinoPdf = path.join(DOWNLOADS_DIR, pedido.nombreArchivoDrive);
  await download.saveAs(destinoPdf);
  console.log(`[Shalom PRO] 📄 Rótulo descargado y renombrado: ${destinoPdf}`);

  return {
    codigoShalom,
    numeroOrdenShalom,
    claveRetiro: clave,
    pdfPath: destinoPdf,
    pdfName: pedido.nombreArchivoDrive,
  };
}

async function ejecutarCiclo() {
  const data = await obtenerPendientesCrm();
  console.log(
    `[Worker] Pendientes listos: ${data.listos.length} | Incompletos: ${data.incompletos.length}`
  );
  for (const inc of data.incompletos) {
    console.log(`  ⏳ ${inc.numeroOrden} (${inc.cliente}): falta ${inc.faltantes.join(", ")}`);
  }

  if (DRY_RUN) {
    for (const p of data.listos) {
      console.log(`  ✅ [DRY-RUN] ${p.numeroOrden} | ${p.clienteNombre} | DNI ${p.clienteDni} | ${p.agenciaShalomDestino} | Clave ${p.claveRetiroSugerida} | PDF: ${p.nombreArchivoDrive}`);
    }
    return;
  }

  if (data.listos.length === 0) return;

  // Abrir Chrome únicamente cuando haya al menos 1 pedido listo y cerrarlo al terminar
  const context = await abrirNavegador();
  try {
    const page = context.pages()[0] || (await context.newPage());
    await asegurarSesionShalomPro(page);

    for (const pedido of data.listos) {
      try {
        const shalomRes = await registrarEnvioEnShalomPro(page, pedido);
        const driveRes = subirADriveConCli(shalomRes.pdfPath, shalomRes.pdfName, DRIVE_FOLDER_ID);
        const crmRes = await completarEnCrm({
          pedidoId: pedido.pedidoId,
          numeroOrdenShalom: shalomRes.numeroOrdenShalom,
          codigoShalom: shalomRes.codigoShalom,
          claveRetiro: shalomRes.claveRetiro,
          driveFileName: shalomRes.pdfName,
          driveFileUrl: driveRes.fileUrl,
          registrarEnAliclik: true,
        });
        console.log(
          `[Worker] 🎉 Flujo completado para ${pedido.numeroOrden}: AliClik=${crmRes.aliclikOrderNumber || "revisar"} · Supervisores alertados=${crmRes.supervisoresNotificados}`
        );
      } catch (err) {
        console.error(`[Worker] ❌ Error procesando ${pedido.numeroOrden}:`, err.message);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  if (DRY_RUN) {
    await ejecutarCiclo();
    return;
  }
  if (LOGIN_ONLY) {
    const context = await abrirNavegador();
    try {
      const page = context.pages()[0] || (await context.newPage());
      await asegurarSesionShalomPro(page);
      console.log("[Worker] Sesión guardada en perfil persistente. Ya puedes cerrar.");
    } finally {
      await context.close().catch(() => {});
    }
    return;
  }

  let ocupado = false;
  const correrSeguro = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      await ejecutarCiclo();
    } catch (e) {
      console.error("[Worker] Error ciclo:", e.message);
    } finally {
      ocupado = false;
    }
  };

  await correrSeguro();
  if (WATCH) {
    console.log("[Worker] Modo vigilancia activo (cada 60s, Chrome solo se abrirá cuando haya pedidos listos). Ctrl+C para detener.");
    setInterval(correrSeguro, 60_000);
    await new Promise(() => {});
  }
}

main().catch((err) => {
  console.error("[Worker] Error fatal:", err);
  process.exit(1);
});
