const DEPARTAMENTOS_Y_CIUDADES_VALIDOS = new Set([
  // 25 departamentos / regiones oficiales + Callao
  "amazonas",
  "ancash",
  "apurimac",
  "arequipa",
  "ayacucho",
  "cajamarca",
  "callao",
  "cusco",
  "cuzco",
  "huancavelica",
  "huanuco",
  "ica",
  "junin",
  "la libertad",
  "lambayeque",
  "lima",
  "lima metropolitana",
  "lima provincias",
  "loreto",
  "madre de dios",
  "moquegua",
  "pasco",
  "piura",
  "puno",
  "san martin",
  "tacna",
  "tumbes",
  "ucayali",
  // Ciudades principales de Perú
  "chachapoyas",
  "bagua",
  "huaraz",
  "chimbote",
  "casma",
  "abancay",
  "andahuaylas",
  "camana",
  "mollendo",
  "huamanga",
  "jaen",
  "chota",
  "urubamba",
  "sicuani",
  "quillabamba",
  "tingo maria",
  "chincha",
  "pisco",
  "nazca",
  "huancayo",
  "tarma",
  "satipo",
  "chanchamayo",
  "la merced",
  "trujillo",
  "chepen",
  "pacasmayo",
  "chiclayo",
  "ferrenafe",
  "huacho",
  "huaral",
  "canete",
  "barranca",
  "chancay",
  "iquitos",
  "yurimaguas",
  "puerto maldonado",
  "ilo",
  "cerro de pasco",
  "oxapampa",
  "sullana",
  "talara",
  "paita",
  "catacaos",
  "sechura",
  "juliaca",
  "tarapoto",
  "moyobamba",
  "rioja",
  "juanjui",
  "pucallpa",
  "yarinacocha",
  // Distritos principales de Lima
  "miraflores",
  "san isidro",
  "surco",
  "santiago de surco",
  "la molina",
  "san borja",
  "san miguel",
  "magdalena",
  "pueblo libre",
  "jesus maria",
  "lince",
  "brena",
  "cercado de lima",
  "la victoria",
  "san luis",
  "ate",
  "santa anita",
  "el agustino",
  "san juan de lurigancho",
  "sjl",
  "san martin de porres",
  "smp",
  "los olivos",
  "independencia",
  "comas",
  "carabayllo",
  "puente piedra",
  "ancon",
  "santa rosa",
  "chorrillos",
  "barranco",
  "surquillo",
  "san juan de miraflores",
  "sjm",
  "villa maria del triunfo",
  "vmt",
  "villa el salvador",
  "ves",
  "lurin",
  "pachacamac",
  "chosica",
  "lurigancho",
  "chaclacayo",
  "cieneguilla",
  "rimac",
  "ventanilla",
  "bellavista",
  "la perla",
  "carmen de la legua",
  "mi peru",
]);

function normalizarTexto(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * M2: Valida que un teléfono de cliente sea un celular peruano válido (9 dígitos empezando con 9).
 * Rechaza identificadores de Meta (+1143828...), teléfonos incompletos o fijos inválidos.
 */
export function validarTelefonoPeruano(rawPhone: string | null | undefined): {
  valido: boolean;
  telefono9Digitos?: string;
  telefonoE164?: string;
  error?: string;
} {
  const digitos = String(rawPhone || "").replace(/\D/g, "");
  if (!digitos) {
    return {
      valido: false,
      error: "El teléfono del cliente es obligatorio (9 dígitos que empiecen con 9).",
    };
  }

  // Si tiene prefijo de Perú 51 + 9 dígitos (11 dígitos en total)
  if (digitos.length === 11 && digitos.startsWith("519")) {
    const cel = digitos.slice(2);
    return {
      valido: true,
      telefono9Digitos: cel,
      telefonoE164: `+51${cel}`,
    };
  }

  // Si tiene exactamente 9 dígitos y empieza con 9
  if (digitos.length === 9 && digitos.startsWith("9")) {
    return {
      valido: true,
      telefono9Digitos: digitos,
      telefonoE164: `+51${digitos}`,
    };
  }

  // Detectar ID de Meta (13 a 17 dígitos o empieza con +114...)
  if (digitos.length > 11 || !digitos.startsWith("9")) {
    return {
      valido: false,
      error: `El teléfono "${rawPhone}" no es un celular peruano válido (debe tener 9 dígitos y empezar con 9, no un ID de Meta).`,
    };
  }

  return {
    valido: false,
    error: `El teléfono "${rawPhone}" es inválido. Debe tener 9 dígitos y empezar con 9.`,
  };
}

/**
 * M2: Valida que la ciudad/departamento de destino sea una ubicación real de Perú y no texto basura (ej. "sdsf").
 */
export function validarDepartamentoODestino(
  ciudadODepartamento: string | null | undefined
): {
  valido: boolean;
  destinoLimpio?: string;
  error?: string;
} {
  const raw = String(ciudadODepartamento || "").trim();
  const norm = normalizarTexto(raw);
  if (!norm || norm.length < 3) {
    return {
      valido: false,
      error: "Debes indicar un departamento o ciudad válida de Perú.",
    };
  }

  if (DEPARTAMENTOS_Y_CIUDADES_VALIDOS.has(norm)) {
    return { valido: true, destinoLimpio: raw };
  }

  // Permitir coincidencias compuestas como "Chiclayo - Lambayeque" o "Trujillo, La Libertad"
  for (const valido of DEPARTAMENTOS_Y_CIUDADES_VALIDOS) {
    if (
      valido.length >= 3 &&
      new RegExp(`\\b${valido}\\b`, "i").test(norm)
    ) {
      return { valido: true, destinoLimpio: raw };
    }
  }

  return {
    valido: false,
    error: `El destino o departamento "${raw}" no es válido en Perú. Ingresa un departamento o ciudad real (ej. Lima, Arequipa, Chiclayo, Trujillo).`,
  };
}
