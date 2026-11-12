export interface ShopifyNoteAttribute {
  name: string;
  value: unknown;
}

export interface ExtractedOrderData {
  nombreCliente: string;
  telefono: string | null;
  email: string | null;
  dni: string | null;
  departamento: string | null;
  ciudad: string;
  distrito: string | null;
  direccionEnvio: string | null;
  referencia: string | null;
  esProvincia: boolean;
  destinoResumen: string;
  notas: string | null;
}

export function normalizarTelefonoPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.startsWith("51") && digits.length === 11) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function limpiarTexto(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function normalizarClave(clave: string): string {
  return clave
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[:_\-\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISTRITOS_LIMA_CALLAO = [
  "lima", "cercado de lima", "callao", "miraflores", "san isidro", "santiago de surco", "surco",
  "san borja", "barranco", "la molina", "magdalena", "magdalena del mar", "san miguel",
  "pueblo libre", "jesus maria", "lince", "brena", "rimac", "la victoria", "san luis",
  "santa anita", "ate", "ate vitarte", "vitarte", "el agustino", "san juan de lurigancho",
  "sjl", "los olivos", "san martin de porres", "smp", "independencia", "comas",
  "carabayllo", "puente piedra", "ancon", "santa rosa", "san juan de miraflores",
  "sjm", "villa maria del triunfo", "vmt", "villa el salvador", "ves", "chorrillos",
  "lurin", "pachacamac", "pucusana", "punta hermosa", "punta negra", "san bartolo",
  "santa maria del mar", "cieneguilla", "bellavista", "carmen de la legua", "la perla",
  "la punta", "ventanilla", "mi peru", "manchay", "huachipa", "chosica", "chaclacayo",
  "lurigancho"
];

const REGIONES_PROVINCIA = [
  "amazonas", "ancash", "apurimac", "arequipa", "ayacucho", "cajamarca", "cusco", "cuzco",
  "huancavelica", "huanuco", "ica", "junin", "la libertad", "lambayeque", "loreto",
  "madre de dios", "moquegua", "pasco", "piura", "puno", "san martin", "tacna", "tumbes", "ucayali",
  "trujillo", "chiclayo", "huancayo", "chimbote", "iquitos", "pucallpa", "juliaca", "tarapoto",
  "sullana", "chincha", "pisco", "huacho", "barranca", "canete", "talara", "ilo", "huaraz", "paita"
];

function esRegionProvincia(...textos: (string | null | undefined)[]): boolean {
  for (const t of textos) {
    if (!t) continue;
    const clean = t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    for (const reg of REGIONES_PROVINCIA) {
      const regex = new RegExp(`\\b${reg}\\b`, "i");
      if (clean === reg || regex.test(clean)) {
        return true;
      }
    }
  }
  return false;
}

function esUbicacionLimaOCallao(...textos: (string | null | undefined)[]): boolean {
  for (const t of textos) {
    if (!t) continue;
    const clean = t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    for (const dist of DISTRITOS_LIMA_CALLAO) {
      // Coincidencia de palabra completa o subcadena clave
      const regex = new RegExp(`\\b${dist}\\b`, "i");
      if (clean === dist || regex.test(clean) || clean.includes(` ${dist}`) || clean.includes(`${dist} `)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Extrae y sintetiza de forma exhaustiva los campos enviados desde formularios
 * COD de Shopify (como EasySell, Releasit, COD Monster, checkout nativo) y sus note_attributes.
 */
export function extraerDatosFormularioShopify(payload: Record<string, any>): ExtractedOrderData {
  const noteAttributes: Record<string, string> = {};

  if (Array.isArray(payload.note_attributes)) {
    for (const attr of payload.note_attributes as ShopifyNoteAttribute[]) {
      if (!attr || !attr.name) continue;
      const keyNorm = normalizarClave(attr.name);
      noteAttributes[keyNorm] = limpiarTexto(attr.value);
    }
  }

  const shipping = (payload.shipping_address || payload.billing_address || {}) as Record<string, any>;
  const billing = (payload.billing_address || {}) as Record<string, any>;
  const customer = (payload.customer || {}) as Record<string, any>;

  // 1. Nombre completo
  const nombreAttr =
    noteAttributes["nombre y apellido"] ||
    noteAttributes["nombre completo"] ||
    noteAttributes["nombre"] ||
    noteAttributes["cliente"] ||
    noteAttributes["customer name"];

  const nombreShipping = [
    shipping.first_name ?? customer.first_name,
    shipping.last_name ?? customer.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const nombreCliente =
    nombreAttr ||
    (nombreShipping.length > 1 ? nombreShipping : null) ||
    shipping.name ||
    customer.first_name ||
    "Cliente Shopify Aliv";

  // 2. Teléfono
  const telAttr =
    noteAttributes["telefono"] ||
    noteAttributes["celular"] ||
    noteAttributes["whatsapp"] ||
    noteAttributes["movil"] ||
    noteAttributes["phone"];

  const telRaw =
    telAttr ||
    shipping.phone ||
    billing.phone ||
    customer.phone ||
    "";

  const telefono = normalizarTelefonoPeru(telRaw);

  // 3. Email
  const emailAttr = noteAttributes["email"] || noteAttributes["correo"];
  const email = (emailAttr || customer.email || "").trim().toLowerCase() || null;

  // 4. DNI / RUC
  const dniAttr =
    noteAttributes["dni"] ||
    noteAttributes["dni / ruc"] ||
    noteAttributes["dni ruc"] ||
    noteAttributes["documento"] ||
    noteAttributes["cedula"] ||
    noteAttributes["identificacion"];

  let dni = dniAttr || null;
  if (!dni && shipping.company && /^\d{8,11}$/.test(String(shipping.company).trim())) {
    dni = String(shipping.company).trim();
  }

  // 5. Ciudad / Departamento / Provincia
  const deptoAttr =
    noteAttributes["departamento"] ||
    noteAttributes["region"];

  const ciudadAttr =
    noteAttributes["ciudad"] ||
    noteAttributes["provincia"] ||
    deptoAttr;

  let ciudadRaw =
    ciudadAttr ||
    shipping.province ||
    shipping.city ||
    "Lima";

  ciudadRaw = ciudadRaw
    .replace(/\s*\/\s*per[uú]/i, "")
    .replace(/\s*per[uú]/i, "")
    .trim();

  if (!ciudadRaw) ciudadRaw = "Lima";
  const ciudad = ciudadRaw;

  // 6. Distrito
  const distritoAttr =
    noteAttributes["distrito"] ||
    noteAttributes["localidad"] ||
    noteAttributes["barrio"] ||
    noteAttributes["zona"];

  let distrito: string | null = distritoAttr || null;
  if (!distrito && shipping.city) {
    const rawCity = String(shipping.city).trim();
    if (
      shipping.province &&
      rawCity.toLowerCase() !== String(shipping.province).trim().toLowerCase()
    ) {
      distrito = rawCity;
    }
  }

  // 7. Referencia
  const refAttr =
    noteAttributes["referencia"] ||
    noteAttributes["referencia de entrega"] ||
    noteAttributes["piso / depto"] ||
    noteAttributes["piso"] ||
    noteAttributes["apartamento"];
  const referencia = refAttr || null;

  // 8. Dirección completa y exacta
  const dirAttr =
    noteAttributes["direccion completa"] ||
    noteAttributes["direccion"] ||
    noteAttributes["direccion de entrega"] ||
    noteAttributes["domicilio"] ||
    noteAttributes["calle"] ||
    noteAttributes["address"];

  const dirShipping = [shipping.address1, shipping.address2].filter(Boolean).join(" — ");

  // Seleccionar la dirección más descriptiva
  let direccionBase: string | null = null;
  if (dirAttr && dirShipping) {
    // Si la del atributo tiene más detalle o son distintas, dar prioridad al formulario
    direccionBase = dirAttr.length >= dirShipping.length ? dirAttr : `${dirShipping} (${dirAttr})`;
  } else {
    direccionBase = dirAttr || dirShipping || null;
  }

  let direccionEnvio = direccionBase;
  if (direccionEnvio && referencia && !direccionEnvio.toLowerCase().includes(referencia.toLowerCase())) {
    direccionEnvio = `${direccionEnvio} (Ref: ${referencia})`;
  }

  // 9. Flag Provincia vs Lima/Callao
  // Regla segura: Solo evaluar campos de localidad (ciudad, distrito, departamento).
  // NUNCA evaluar el texto libre de direccionEnvio porque una calle como "Av. Lima 123" en Arequipa generaba falsos positivos.
  const esProvinciaExplicita = esRegionProvincia(deptoAttr, ciudad, distrito);
  let esLima = false;

  if (esProvinciaExplicita) {
    esLima = false;
  } else {
    // Si no es provincia explícita, verificar si ciudad, distrito o departamento corresponden a Lima/Callao
    esLima = esUbicacionLimaOCallao(ciudad, distrito, deptoAttr);
  }

  const esProvincia = !esLima;

  // Si detectamos que es un distrito de Lima/Callao pero en ciudad pusieron el distrito:
  let ciudadFinal = ciudad;
  let distritoFinal = distrito;
  if (esLima && ciudad.toLowerCase() !== "lima" && ciudad.toLowerCase() !== "callao") {
    if (!distritoFinal) distritoFinal = ciudad;
    ciudadFinal = "Lima";
  }

  // 10. Resumen de destino deduplicado
  const partesDestino: string[] = [];
  if (ciudadFinal) partesDestino.push(ciudadFinal);
  if (distritoFinal && distritoFinal.toLowerCase() !== ciudadFinal.toLowerCase()) {
    partesDestino.push(distritoFinal);
  }
  if (direccionEnvio) partesDestino.push(direccionEnvio);

  const destinoResumen = partesDestino.join(" — ");

  return {
    nombreCliente,
    telefono,
    email,
    dni,
    departamento: deptoAttr || null,
    ciudad: ciudadFinal,
    distrito: distritoFinal,
    direccionEnvio,
    referencia,
    esProvincia,
    destinoResumen,
    notas: payload.note || null,
  };
}
