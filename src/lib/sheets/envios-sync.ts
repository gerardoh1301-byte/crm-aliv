import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/db";
import { deals, contacts, pipelineStages, teamMembers } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { eq, desc } from "drizzle-orm";

export const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_ENVIOS_ID || "1vBgWP5MELBc-hiq-Mz4gBJqpxvF2sKTEGhfnddZpkoo";
export const SHEET_NAME = "En Camino y Despachos";
export const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

const CANDIDATAS_TOKEN = [
  process.env.GOOGLE_SHEETS_TOKEN_PATH,
  join(process.env.USERPROFILE || "C:\\Users\\USER", ".gemini", "antigravity", "plugin_data", "gsheets", "token.json"),
  join(process.cwd(), ".local", "gsheets_token.json"),
].filter(Boolean) as string[];

/**
 * Obtiene un cliente autenticado para la API de Google Sheets usando el token OAuth.
 */
async function obtenerAccessToken(): Promise<string | null> {
  try {
    for (const ruta of CANDIDATAS_TOKEN) {
      if (existsSync(ruta)) {
        const raw = readFileSync(ruta, "utf8");
        const tokenData = JSON.parse(raw);
        if (tokenData?.client_id && tokenData?.client_secret && tokenData?.token?.refresh_token) {
          const client = new OAuth2Client(tokenData.client_id, tokenData.client_secret);
          client.setCredentials({ refresh_token: tokenData.token.refresh_token });
          const res = await client.getAccessToken();
          if (res?.token) return res.token;
        }
      }
    }
  } catch (err) {
    console.error("[SheetsSync] Error obteniendo access token:", err);
  }
  return null;
}

export interface FilaEnvioSheet {
  fecha: string;
  orderNum: string;
  cliente: string;
  celular: string;
  dni: string;
  ciudad: string;
  direccion: string;
  transporte: string;
  motorizado: string;
  agencia: string;
  guia: string;
  rastreo: string;
  clave: string;
  total: number;
  adelanto: number;
  saldo: number;
  estado: string;
  asesor: string;
  notas: string;
  idCrm: string;
}

/**
 * Convierte un Deal y Pedido en una fila estandarizada para Google Sheets.
 */
function transformarADatosFila(
  deal: {
    id: string;
    title: string;
    value: number;
    notes?: string | null;
    updatedAt?: Date | null;
  },
  contacto?: {
    name: string;
    phone?: string | null;
    customFields?: unknown;
    dni?: string | null;
  } | null,
  pedido?: {
    numeroOrden: string;
    dniCliente?: string | null;
    ciudad?: string | null;
    distrito?: string | null;
    direccionEnvio?: string | null;
    transportadora?: string | null;
    numeroGuia?: string | null;
    codigoRastreo?: string | null;
    claveRecojo?: string | null;
    total?: string | null;
    notas?: string | null;
    motorizadoNombre?: string | null;
  } | null,
  asesorNombre?: string | null,
  etapaNombre?: string | null
): FilaEnvioSheet {
  let custom: Record<string, any> = {};
  try {
    if (typeof contacto?.customFields === "string") {
      custom = JSON.parse(contacto.customFields);
    } else if (contacto?.customFields && typeof contacto.customFields === "object") {
      custom = contacto.customFields as Record<string, any>;
    }
  } catch {
    custom = {};
  }

  const orderNum =
    pedido?.numeroOrden ||
    deal.title.split("·")[0]?.trim() ||
    `#ORD-${deal.id.slice(0, 6).toUpperCase()}`;

  const fecha = (deal.updatedAt || new Date()).toLocaleString("es-PE", {
    timeZone: "America/Lima",
  });

  const cliente = contacto?.name || "Sin nombre";
  const celular = contacto?.phone || "";
  const dni = pedido?.dniCliente || custom.dni || "";

  const ciudad =
    pedido?.ciudad || custom.departamento_ciudad || custom.ciudad || "Lima";
  const direccion =
    pedido?.direccionEnvio || custom.direccion_envio || custom.distrito || "";

  const guia = pedido?.numeroGuia || custom.guia_shalom || "";
  const rastreo = pedido?.codigoRastreo || custom.codigo_rastreo || "";
  const clave = pedido?.claveRecojo || custom.clave_recojo || "";

  const esShalom =
    (pedido?.transportadora && pedido.transportadora.toLowerCase().includes("shalom")) ||
    (custom.modalidad_entrega && custom.modalidad_entrega.toLowerCase().includes("shalom")) ||
    Boolean(guia) ||
    Boolean(rastreo) ||
    Boolean(clave) ||
    direccion.toLowerCase().includes("shalom") ||
    (deal.notes && deal.notes.toLowerCase().includes("shalom"));

  const transporte = esShalom ? "Shalom (Agencia)" : "Motorizado Aliv (Lima)";
  const motorizado = esShalom ? "" : pedido?.motorizadoNombre || "Motorizado Aliv Lima";

  let agencia = "";
  if (esShalom) {
    if (direccion.toLowerCase().includes("agencia")) {
      agencia = direccion;
    } else if (deal.notes && deal.notes.includes("Agencia:")) {
      const match = deal.notes.match(/Agencia:\s*([^|]+)/i);
      agencia = match ? match[1].trim() : direccion;
    } else {
      agencia = `Agencia Shalom ${ciudad}`;
    }
  }

  // Monto total en soles
  let totalNum = 0;
  if (pedido?.total) {
    totalNum = parseFloat(pedido.total);
  } else if (deal.value > 1000) {
    totalNum = deal.value / 100; // Almacenado en céntimos
  } else {
    totalNum = deal.value;
  }

  let adelantoNum = 0;
  if (esShalom) {
    adelantoNum = 20; // Adelanto estándar para envíos a provincia por Shalom
  }
  const saldoNum = Math.max(0, totalNum - adelantoNum);

  const estado = etapaNombre || "En camino / Despachado";
  const asesor = asesorNombre || "Lourdes";
  const notas = pedido?.notas || deal.notes || deal.title;
  const idCrm = deal.id;

  return {
    fecha,
    orderNum,
    cliente,
    celular,
    dni,
    ciudad,
    direccion,
    transporte,
    motorizado,
    agencia,
    guia,
    rastreo,
    clave,
    total: totalNum,
    adelanto: adelantoNum,
    saldo: saldoNum,
    estado,
    asesor,
    notas,
    idCrm,
  };
}

/**
 * Convierte un objeto FilaEnvioSheet en el arreglo ordenado de celdas A:T.
 * Preserva números de teléfono, DNI, guías y clave secreta con prefijo `'`
 * para garantizar que Google Sheets mantenga ceros a la izquierda (ej. '0011').
 */
function filaAValoresSheet(f: FilaEnvioSheet): (string | number)[] {
  return [
    f.fecha,
    f.orderNum,
    f.cliente,
    f.celular ? `'${f.celular.replace(/^'+/, "")}` : "",
    f.dni ? `'${f.dni.replace(/^'+/, "")}` : "",
    f.ciudad,
    f.direccion,
    f.transporte,
    f.motorizado,
    f.agencia,
    f.guia ? `'${f.guia.replace(/^'+/, "")}` : "",
    f.rastreo,
    f.clave ? `'${f.clave.replace(/^'+/, "")}` : "", // Preserva ceros ej. 0011
    f.total,
    f.adelanto,
    f.saldo,
    f.estado,
    f.asesor,
    f.notas,
    f.idCrm,
  ];
}

/**
 * Sincroniza un Deal individual en el Google Sheet de respaldo.
 * Si ya existe una fila para este dealId (Columna T) o N° Orden (Columna B), la actualiza en su lugar.
 * Si no existe y está en `en_reparto`, la añade al final.
 */
export async function sincronizarDealEnSheets(dealId: string): Promise<boolean> {
  try {
    const accessToken = await obtenerAccessToken();
    if (!accessToken) {
      console.warn("[SheetsSync] No se encontró access token de Google Sheets");
      return false;
    }

    // 1. Obtener Deal + Contacto + Etapa + Asesor + Pedido
    const [deal] = await db
      .select({
        id: deals.id,
        title: deals.title,
        value: deals.value,
        notes: deals.notes,
        stageId: deals.stageId,
        contactId: deals.contactId,
        updatedAt: deals.updatedAt,
      })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);

    if (!deal) return false;

    const [stage] = await db
      .select({ id: pipelineStages.id, key: pipelineStages.key, name: pipelineStages.name })
      .from(pipelineStages)
      .where(eq(pipelineStages.id, deal.stageId))
      .limit(1);

    const [contacto] = deal.contactId
      ? await db
          .select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
            customFields: contacts.customFields,
            ownerId: contacts.ownerId,
          })
          .from(contacts)
          .where(eq(contacts.id, deal.contactId))
          .limit(1)
      : [];

    const [asesor] = contacto?.ownerId
      ? await db
          .select({ name: teamMembers.name })
          .from(teamMembers)
          .where(eq(teamMembers.id, contacto.ownerId))
          .limit(1)
      : [];

    const [pedido] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.dealId, deal.id))
      .limit(1);

    const datosFila = transformarADatosFila(
      deal,
      contacto,
      pedido,
      asesor?.name,
      stage?.name
    );
    const valoresFila = filaAValoresSheet(datosFila);

    // 2. Leer filas actuales para saber si ya existe
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${SHEET_NAME}'!A:T`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      console.error("[SheetsSync] Error leyendo filas de Sheets:", await readRes.text());
      return false;
    }
    const readJson = await readRes.json();
    const rows: string[][] = readJson.values || [];

    // Buscar coincidencia por Columna T (ID CRM = index 19) o Columna B (N° Orden = index 1)
    let filaEncontradaIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowCrmId = row[19]?.trim();
      const rowOrderNum = row[1]?.trim();
      if ((rowCrmId && rowCrmId === deal.id) || (rowOrderNum && rowOrderNum === datosFila.orderNum)) {
        filaEncontradaIndex = i + 1; // 1-based index de fila de hoja
        break;
      }
    }

    if (filaEncontradaIndex !== -1) {
      // Actualizar fila existente
      const updateRange = `'${SHEET_NAME}'!A${filaEncontradaIndex}:T${filaEncontradaIndex}`;
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
          updateRange
        )}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: updateRange,
            majorDimension: "ROWS",
            values: [valoresFila],
          }),
        }
      );
      return updateRes.ok;
    } else {
      // Solo agregar si la etapa es "en_reparto" (En camino / Despachado)
      if (stage?.key === "en_reparto") {
        const appendRange = `'${SHEET_NAME}'!A:T`;
        const appendRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
            appendRange
          )}:append?valueInputOption=USER_ENTERED`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              range: appendRange,
              majorDimension: "ROWS",
              values: [valoresFila],
            }),
          }
        );
        return appendRes.ok;
      }
    }

    return true;
  } catch (err) {
    console.error("[SheetsSync] Error en sincronizarDealEnSheets:", err);
    return false;
  }
}

/**
 * Sincronización completa de todos los pedidos en estado 'en_reparto'.
 * Vuelve a dar formato profesional a la hoja y asegura que todas las órdenes
 * activas estén respaldadas con sus guías y claves de retiro Shalom.
 */
export async function sincronizarTodosLosEnviosEnSheets(): Promise<{
  ok: boolean;
  total: number;
  url: string;
  error?: string;
}> {
  try {
    const accessToken = await obtenerAccessToken();
    if (!accessToken) {
      return { ok: false, total: 0, url: SPREADSHEET_URL, error: "No se encontró token de Google Sheets" };
    }

    const stageReparto = await db.query.pipelineStages.findFirst({
      where: eq(pipelineStages.key, "en_reparto"),
    });

    if (!stageReparto) {
      return { ok: false, total: 0, url: SPREADSHEET_URL, error: "Etapa en_reparto no encontrada" };
    }

    const dealsEnReparto = await db
      .select({
        id: deals.id,
        title: deals.title,
        value: deals.value,
        notes: deals.notes,
        stageId: deals.stageId,
        contactId: deals.contactId,
        updatedAt: deals.updatedAt,
      })
      .from(deals)
      .where(eq(deals.stageId, stageReparto.id))
      .orderBy(desc(deals.updatedAt));

    const allPedidos = await db.select().from(pedidosOrdenes);
    const allContacts = await db.select().from(contacts);
    const allMembers = await db.select().from(teamMembers);

    const headers = [
      "Fecha Despacho",
      "N° Orden",
      "Cliente",
      "Celular / WhatsApp",
      "DNI Cliente",
      "Ciudad / Depto",
      "Distrito / Dirección",
      "Transporte",
      "Motorizado Asignado",
      "Agencia Shalom Destino",
      "N° Guía Shalom",
      "Código Rastreo",
      "🔑 Clave Retiro Shalom",
      "Total (S/)",
      "Adelanto (S/)",
      "Saldo a Cobrar (S/)",
      "Estado Envío",
      "Asesor a Cargo",
      "Notas / Detalle",
      "ID CRM",
    ];

    const rows: (string | number)[][] = [headers];

    for (const d of dealsEnReparto) {
      const ped = allPedidos.find((p) => p.dealId === d.id || p.contactId === d.contactId);
      const contacto = allContacts.find((c) => c.id === d.contactId);
      const asesor = contacto?.ownerId
        ? allMembers.find((m) => m.id === contacto.ownerId)?.name
        : "Lourdes";

      const fila = transformarADatosFila(
        d,
        contacto,
        ped,
        asesor,
        stageReparto.name
      );
      rows.push(filaAValoresSheet(fila));
    }

    // 1. Limpiar hoja previa
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${SHEET_NAME}'!A1:Z100:clear`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // 2. Escribir todas las filas
    const targetRange = `'${SHEET_NAME}'!A1:T${rows.length}`;
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
        targetRange
      )}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range: targetRange,
          majorDimension: "ROWS",
          values: rows,
        }),
      }
    );

    // 3. Obtener sheetId numérico para dar estilos visuales
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const sheetMeta = await metaRes.json();
    const targetSheetId =
      sheetMeta.sheets?.find((s: any) => s.properties.title === SHEET_NAME)?.properties.sheetId ?? 0;

    // 4. Aplicar estilos ejecutivos
    const batchRequests = [
      // Inmovilizar fila 1
      {
        updateSheetProperties: {
          properties: {
            sheetId: targetSheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Encabezado corporativo verde Aliv (#0F5132), texto blanco y negrita
      {
        repeatCell: {
          range: {
            sheetId: targetSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 20,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 15 / 255, green: 81 / 255, blue: 50 / 255 },
              textFormat: {
                bold: true,
                foregroundColor: { red: 1, green: 1, blue: 1 },
                fontSize: 10,
              },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
        },
      },
      // Resaltar columna 🔑 Clave Retiro Shalom (Columna M = index 12)
      {
        repeatCell: {
          range: {
            sheetId: targetSheetId,
            startRowIndex: 1,
            endRowIndex: rows.length,
            startColumnIndex: 12,
            endColumnIndex: 13,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 254 / 255, green: 243 / 255, blue: 199 / 255 }, // Amarillo suave (#FEF3C7)
              textFormat: {
                bold: true,
                foregroundColor: { red: 146 / 255, green: 64 / 255, blue: 14 / 255 },
                fontSize: 11,
              },
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      },
      // Formato moneda a columnas Total (N), Adelanto (O), Saldo (P)
      {
        repeatCell: {
          range: {
            sheetId: targetSheetId,
            startRowIndex: 1,
            endRowIndex: rows.length,
            startColumnIndex: 13,
            endColumnIndex: 16,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "RIGHT",
              numberFormat: {
                type: "CURRENCY",
                pattern: '"S/ "###,##0.00',
              },
            },
          },
          fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
        },
      },
      // Auto-ajustar columnas
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: targetSheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: 20,
          },
        },
      },
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests: batchRequests }),
    });

    return { ok: true, total: rows.length - 1, url: SPREADSHEET_URL };
  } catch (err: any) {
    console.error("[SheetsSync] Error en sincronizarTodosLosEnviosEnSheets:", err);
    return { ok: false, total: 0, url: SPREADSHEET_URL, error: err?.message || String(err) };
  }
}
