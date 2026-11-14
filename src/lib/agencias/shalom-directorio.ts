/**
 * Directorio y motor de búsqueda de agencias Shalom en todo el Perú.
 * Permite identificar de inmediato la agencia Shalom más cercana a la dirección,
 * calle, distrito o referencia del cliente en provincias para proponérsela
 * proactivamente como primera opción.
 */

export interface AgenciaShalom {
  id: string;
  nombre: string;
  departamento: string;
  provincia: string;
  distrito: string;
  direccion: string;
  referencia?: string;
  telefono?: string;
  horario?: string;
  principal?: boolean;
  coincidencias?: string[];
}

export const AGENCIAS_SHALOM_PERU: AgenciaShalom[] = [
  // --- PIURA / SULLANA / TALARA / PAITA ---
  {
    id: "sullana-santa-rosa",
    nombre: "Shalom Sullana - Santa Rosa",
    departamento: "Piura",
    provincia: "Sullana",
    distrito: "Sullana",
    direccion: "Jr. Santa Rosa 450",
    referencia: "Cerca a Plaza de Armas de Sullana y Calle Dos / Tres",
    principal: true,
    coincidencias: ["sullana", "santa rosa", "sta rosa", "calle dos", "calle tres", "plaza sullana", "centro sullana"],
  },
  {
    id: "sullana-jose-de-lama",
    nombre: "Shalom Sullana - Av. José de Lama",
    departamento: "Piura",
    provincia: "Sullana",
    distrito: "Sullana",
    direccion: "Av. José de Lama 1235",
    referencia: "Frente al óvalo Turicarami",
    coincidencias: ["jose de lama", "turicarami", "ovalo turicarami", "bellavista sullana"],
  },
  {
    id: "piura-sanchez-cerro",
    nombre: "Shalom Piura - Av. Sánchez Cerro",
    departamento: "Piura",
    provincia: "Piura",
    distrito: "Piura",
    direccion: "Av. Sánchez Cerro 1380",
    referencia: "Cerca al Mercado Central y Real Plaza Piura",
    principal: true,
    coincidencias: ["piura", "sanchez cerro", "centro piura", "mercado central", "real plaza piura"],
  },
  {
    id: "piura-grau",
    nombre: "Shalom Piura - Av. Grau",
    departamento: "Piura",
    provincia: "Piura",
    distrito: "Veintiséis de Octubre",
    direccion: "Av. Grau 1640",
    referencia: "Ovalo Grau / Santa Isabel",
    coincidencias: ["veintiseis de octubre", "26 de octubre", "av grau piura", "santa isabel"],
  },
  {
    id: "talara-centro",
    nombre: "Shalom Talara - Av. F",
    departamento: "Piura",
    provincia: "Talara",
    distrito: "Pariñas",
    direccion: "Av. F 142",
    referencia: "Centro de Talara, cerca a Petroperú",
    principal: true,
    coincidencias: ["talara", "pariñas", "av f", "petroperu"],
  },
  {
    id: "paita-centro",
    nombre: "Shalom Paita",
    departamento: "Piura",
    provincia: "Paita",
    distrito: "Paita",
    direccion: "Jr. Zepita 412 (Parte Alta)",
    referencia: "Cerca al óvalo de Paita",
    principal: true,
    coincidencias: ["paita", "puerto paita", "zepita"],
  },

  // --- LAMBAYEQUE / CHICLAYO ---
  {
    id: "chiclayo-bolognesi",
    nombre: "Shalom Chiclayo - Av. Bolognesi",
    departamento: "Lambayeque",
    provincia: "Chiclayo",
    distrito: "Chiclayo",
    direccion: "Av. Bolognesi 635",
    referencia: "A 4 cuadras del Parque Principal de Chiclayo",
    principal: true,
    coincidencias: ["chiclayo", "bolognesi", "centro chiclayo", "parque principal"],
  },
  {
    id: "chiclayo-jlo",
    nombre: "Shalom Chiclayo - José Leonardo Ortiz",
    departamento: "Lambayeque",
    provincia: "Chiclayo",
    distrito: "José Leonardo Ortiz",
    direccion: "Av. Augusto B. Leguía 1480",
    referencia: "Cruce con Av. Chiclayo / Mercado Moshoqueque",
    coincidencias: ["jose leonardo ortiz", "jlo", "leonardo ortiz", "moshoqueque", "leguia"],
  },
  {
    id: "chiclayo-la-victoria",
    nombre: "Shalom Chiclayo - La Victoria",
    departamento: "Lambayeque",
    provincia: "Chiclayo",
    distrito: "La Victoria",
    direccion: "Av. Gran Chimú 850",
    referencia: "Cerca al Parque de la Familia",
    coincidencias: ["la victoria chiclayo", "gran chimu", "parque de la familia"],
  },
  {
    id: "lambayeque-centro",
    nombre: "Shalom Ciudad Lambayeque",
    departamento: "Lambayeque",
    provincia: "Lambayeque",
    distrito: "Lambayeque",
    direccion: "Av. Huamachuco 520",
    referencia: "A espaldas del Museo Tumbas Reales",
    principal: true,
    coincidencias: ["ciudad lambayeque", "museo tumbas reales", "huamachuco"],
  },

  // --- LA LIBERTAD / TRUJILLO ---
  {
    id: "trujillo-mansiche",
    nombre: "Shalom Trujillo - Av. Mansiche",
    departamento: "La Libertad",
    provincia: "Trujillo",
    distrito: "Trujillo",
    direccion: "Av. Mansiche 438",
    referencia: "Frente al Estadio Mansiche / Cerca a Plaza Mayor",
    principal: true,
    coincidencias: ["trujillo", "mansiche", "estadio mansiche", "centro trujillo", "plaza mayor trujillo"],
  },
  {
    id: "trujillo-america-sur",
    nombre: "Shalom Trujillo - Av. América Sur",
    departamento: "La Libertad",
    provincia: "Trujillo",
    distrito: "Trujillo",
    direccion: "Av. América Sur 1245",
    referencia: "Óvalo Papal / Urb. Monserrate",
    coincidencias: ["america sur", "ovalo papal", "monserrate", "upao"],
  },
  {
    id: "trujillo-larco",
    nombre: "Shalom Trujillo - Víctor Larco",
    departamento: "La Libertad",
    provincia: "Trujillo",
    distrito: "Víctor Larco Herrera",
    direccion: "Av. Larco 1120",
    referencia: "Cerca a Buenos Aires / Huanchaco",
    coincidencias: ["victor larco", "av larco", "buenos aires trujillo", "huanchaco"],
  },
  {
    id: "trujillo-esperanza",
    nombre: "Shalom Trujillo - La Esperanza",
    departamento: "La Libertad",
    provincia: "Trujillo",
    distrito: "La Esperanza",
    direccion: "Av. José Gabriel Condorcanqui 1420",
    referencia: "Parte baja de La Esperanza",
    coincidencias: ["la esperanza", "condorcanqui", "florencia de mora"],
  },

  // --- AREQUIPA ---
  {
    id: "arequipa-parra",
    nombre: "Shalom Arequipa - Av. Parra",
    departamento: "Arequipa",
    provincia: "Arequipa",
    distrito: "Arequipa",
    direccion: "Av. Parra 379",
    referencia: "Cercado de Arequipa / Cerca a Terminal Terrestre y Parque Industrial",
    principal: true,
    coincidencias: ["arequipa", "av parra", "parra", "cercado arequipa", "parque industrial", "terminal arequipa"],
  },
  {
    id: "arequipa-cerro-colorado",
    nombre: "Shalom Arequipa - Cerro Colorado",
    departamento: "Arequipa",
    provincia: "Arequipa",
    distrito: "Cerro Colorado",
    direccion: "Av. Villa Hermosa 215",
    referencia: "Vía de Evitamiento / Cerca a Aeropuerto y Zamácola",
    coincidencias: ["cerro colorado", "villa hermosa", "evitamiento arequipa", "aeropuerto arequipa", "zamacola"],
  },
  {
    id: "arequipa-bustamante",
    nombre: "Shalom Arequipa - J.L. Bustamante y Rivero",
    departamento: "Arequipa",
    provincia: "Arequipa",
    distrito: "José Luis Bustamante y Rivero",
    direccion: "Av. Andrés Avelino Cáceres 420",
    referencia: "Plataforma Comercial Andrés Avelino Cáceres",
    coincidencias: ["bustamante y rivero", "avelino caceres", "plataforma avelino", "dolores", "socabaya"],
  },
  {
    id: "arequipa-paucarpata",
    nombre: "Shalom Arequipa - Paucarpata",
    departamento: "Arequipa",
    provincia: "Arequipa",
    distrito: "Paucarpata",
    direccion: "Av. Kennedy 1102",
    referencia: "Cruce con Av. Los Incas / Guardia Civil",
    coincidencias: ["paucarpata", "kennedy", "los incas", "guardia civil arequipa", "mariano melgar"],
  },
  {
    id: "arequipa-cayma",
    nombre: "Shalom Arequipa - Cayma",
    departamento: "Arequipa",
    provincia: "Arequipa",
    distrito: "Cayma",
    direccion: "Av. Ejército 710",
    referencia: "Cerca a Mall Plaza Cayma y Real Plaza",
    coincidencias: ["cayma", "av ejercito", "mall plaza cayma", "yanahuara"],
  },

  // --- CUSCO ---
  {
    id: "cusco-wanchaq",
    nombre: "Shalom Cusco - Wanchaq",
    departamento: "Cusco",
    provincia: "Cusco",
    distrito: "Wanchaq",
    direccion: "Av. Pachacútec 512",
    referencia: "Cerca al Óvalo Pachacútec y Terminal Terrestre",
    principal: true,
    coincidencias: ["cusco", "cuzco", "wanchaq", "pachacutec", "ovalo pachacutec", "terminal cusco"],
  },
  {
    id: "cusco-san-jeronimo",
    nombre: "Shalom Cusco - San Jerónimo",
    departamento: "Cusco",
    provincia: "Cusco",
    distrito: "San Jerónimo",
    direccion: "Vía de Evitamiento 480",
    referencia: "Cerca a San Sebastián y Universidad Andina",
    coincidencias: ["san jeronimo", "san sebastian cusco", "universidad andina", "evitamiento cusco"],
  },
  {
    id: "cusco-santiago",
    nombre: "Shalom Cusco - Santiago",
    departamento: "Cusco",
    provincia: "Cusco",
    distrito: "Santiago",
    direccion: "Av. Antonio Lorena 830",
    referencia: "Cerca a Hospital Antonio Lorena",
    coincidencias: ["santiago cusco", "antonio lorena", "hospital lorena"],
  },

  // --- JUNÍN / HUANCAYO ---
  {
    id: "huancayo-castilla",
    nombre: "Shalom Huancayo - El Tambo / Castilla",
    departamento: "Junín",
    provincia: "Huancayo",
    distrito: "El Tambo",
    direccion: "Av. Mariscal Castilla 1420",
    referencia: "Cerca a Ciudad Universitaria UNCP",
    principal: true,
    coincidencias: ["huancayo", "el tambo", "mariscal castilla", "castilla", "uncp", "centro huancayo"],
  },
  {
    id: "huancayo-chilca",
    nombre: "Shalom Huancayo - Chilca",
    departamento: "Junín",
    provincia: "Huancayo",
    distrito: "Chilca",
    direccion: "Av. 9 de Diciembre 410",
    referencia: "Cerca al Parque Huamanmarca / Salida a Huancavelica",
    coincidencias: ["chilca", "9 de diciembre", "huamanmarca", "salida huancavelica"],
  },

  // --- ÁNCASH / CHIMBOTE / HUARAZ ---
  {
    id: "chimbote-meiggs",
    nombre: "Shalom Chimbote - Av. Enrique Meiggs",
    departamento: "Áncash",
    provincia: "Santa",
    distrito: "Chimbote",
    direccion: "Av. Enrique Meiggs 645",
    referencia: "Frente a Terminal Terrestre El Chimbador",
    principal: true,
    coincidencias: ["chimbote", "meiggs", "el chimbador", "pardo", "centro chimbote"],
  },
  {
    id: "nuevo-chimbote",
    nombre: "Shalom Nuevo Chimbote",
    departamento: "Áncash",
    provincia: "Santa",
    distrito: "Nuevo Chimbote",
    direccion: "Av. Pacífico Mz. B Lt. 14 (Urb. Buenos Aires)",
    referencia: "Cerca a Plaza Mayor de Nuevo Chimbote y UNS",
    coincidencias: ["nuevo chimbote", "av pacifico", "buenos aires chimbote", "uns"],
  },
  {
    id: "huaraz-centro",
    nombre: "Shalom Huaraz",
    departamento: "Áncash",
    provincia: "Huaraz",
    distrito: "Huaraz",
    direccion: "Av. Luzuriaga 910",
    referencia: "Cerca a Plaza de Armas de Huaraz",
    principal: true,
    coincidencias: ["huaraz", "luzuriaga", "plaza de armas huaraz", "independencia huaraz"],
  },

  // --- ICA / CHINCHA / PISCO / NAZCA ---
  {
    id: "ica-cutervo",
    nombre: "Shalom Ica - Av. Cutervo",
    departamento: "Ica",
    provincia: "Ica",
    distrito: "Ica",
    direccion: "Av. Cutervo 180",
    referencia: "Frente a Plaza del Sol Ica",
    principal: true,
    coincidencias: ["ica", "cutervo", "plaza del sol", "centro ica", "panamericana sur ica"],
  },
  {
    id: "chincha-benavides",
    nombre: "Shalom Chincha",
    departamento: "Ica",
    provincia: "Chincha",
    distrito: "Chincha Alta",
    direccion: "Av. Óscar R. Benavides 620",
    referencia: "Cerca al Mercado de Chincha y Antigua Panamericana",
    principal: true,
    coincidencias: ["chincha", "chincha alta", "benavides", "grocio prado", "pueblo nuevo chincha"],
  },
  {
    id: "pisco-americas",
    nombre: "Shalom Pisco",
    departamento: "Ica",
    provincia: "Pisco",
    distrito: "Pisco",
    direccion: "Av. Las Américas 450",
    referencia: "Cerca al óvalo de Pisco",
    principal: true,
    coincidencias: ["pisco", "las americas", "san andres pisco", "paracas"],
  },
  {
    id: "nazca-centro",
    nombre: "Shalom Nazca",
    departamento: "Ica",
    provincia: "Nazca",
    distrito: "Nazca",
    direccion: "Panamericana Sur Km 448",
    referencia: "A 3 cuadras del Boulevard de Nazca",
    principal: true,
    coincidencias: ["nazca", "nasca", "boulevard nazca"],
  },

  // --- TACNA / MOQUEGUA / ILO ---
  {
    id: "tacna-coronel-mendoza",
    nombre: "Shalom Tacna - Coronel Mendoza",
    departamento: "Tacna",
    provincia: "Tacna",
    distrito: "Tacna",
    direccion: "Av. Coronel Mendoza 1420",
    referencia: "Cerca al Mercado Bolognesi y Mercadillos de Tacna",
    principal: true,
    coincidencias: ["tacna", "coronel mendoza", "mercado bolognesi", "mercadillos", "centro tacna"],
  },
  {
    id: "tacna-albarracin",
    nombre: "Shalom Tacna - Gregorio Albarracín",
    departamento: "Tacna",
    provincia: "Tacna",
    distrito: "Coronel Gregorio Albarracín Lanchipa",
    direccion: "Av. Municipal Mz. G Lt. 12",
    referencia: "Cono Sur de Tacna",
    coincidencias: ["albarracin", "gregorio albarracin", "cono sur tacna", "av municipal"],
  },
  {
    id: "ilo-puerto",
    nombre: "Shalom Ilo",
    departamento: "Moquegua",
    provincia: "Ilo",
    distrito: "Ilo",
    direccion: "Av. Mariano Lino Urquieta 512",
    referencia: "Cerca a la Plaza de Armas y Puerto de Ilo",
    principal: true,
    coincidencias: ["ilo", "puerto ilo", "lino urquieta", "pacocha"],
  },
  {
    id: "moquegua-centro",
    nombre: "Shalom Moquegua",
    departamento: "Moquegua",
    provincia: "Mariscal Nieto",
    distrito: "Moquegua",
    direccion: "Av. Minería 230",
    referencia: "Cerca al Terminal Terrestre de Moquegua",
    principal: true,
    coincidencias: ["moquegua", "mariscal nieto", "mineria", "samegua"],
  },

  // --- PUNO / JULIACA ---
  {
    id: "juliaca-san-roman",
    nombre: "Shalom Juliaca",
    departamento: "Puno",
    provincia: "San Román",
    distrito: "Juliaca",
    direccion: "Jr. Mariano Núñez 620",
    referencia: "Cerca a Plaza Túpac Amaru y Mercado Manco Cápac",
    principal: true,
    coincidencias: ["juliaca", "san roman", "mariano nuñez", "tupac amaru juliaca"],
  },
  {
    id: "puno-centro",
    nombre: "Shalom Puno",
    departamento: "Puno",
    provincia: "Puno",
    distrito: "Puno",
    direccion: "Jr. Lampa 280",
    referencia: "Cerca al Puerto Lacustre y Terminal Terrestre",
    principal: true,
    coincidencias: ["puno", "lampa", "lago titicaca puno", "terminal puno"],
  },

  // --- CAJAMARCA / JAÉN ---
  {
    id: "cajamarca-evitamiento",
    nombre: "Shalom Cajamarca",
    departamento: "Cajamarca",
    provincia: "Cajamarca",
    distrito: "Cajamarca",
    direccion: "Av. Vía de Evitamiento Sur 1450",
    referencia: "Cerca al Complejo Qhapaq Ñan y Real Plaza",
    principal: true,
    coincidencias: ["cajamarca", "evitamiento sur", "qhapaq ñan", "baños del inca"],
  },
  {
    id: "jaen-pakamuros",
    nombre: "Shalom Jaén",
    departamento: "Cajamarca",
    provincia: "Jaén",
    distrito: "Jaén",
    direccion: "Av. Pakamuros 1620",
    referencia: "Salida a San Ignacio",
    principal: true,
    coincidencias: ["jaen", "pakamuros", "san ignacio"],
  },

  // --- HUÁNUCO / TINGO MARÍA ---
  {
    id: "huanuco-prado",
    nombre: "Shalom Huánuco",
    departamento: "Huánuco",
    provincia: "Huánuco",
    distrito: "Huánuco",
    direccion: "Jr. General Prado 840",
    referencia: "A 3 cuadras de Plaza Mayor de Huánuco",
    principal: true,
    coincidencias: ["huanuco", "general prado", "amarilis", "pillco marca"],
  },
  {
    id: "tingo-maria-raimondi",
    nombre: "Shalom Tingo María",
    departamento: "Huánuco",
    provincia: "Leoncio Prado",
    distrito: "Rupa Rupa",
    direccion: "Av. Enrique Pimentel 320",
    referencia: "Cerca al Mercado Modelo",
    principal: true,
    coincidencias: ["tingo maria", "leoncio prado", "rupa rupa"],
  },

  // --- SAN MARTÍN (TARAPOTO / MOYOBAMBA) ---
  {
    id: "tarapoto-jimenez",
    nombre: "Shalom Tarapoto",
    departamento: "San Martín",
    provincia: "San Martín",
    distrito: "Tarapoto",
    direccion: "Jr. Jiménez Pimentel 1120",
    referencia: "Cerca a la Vía de Evitamiento y Morales",
    principal: true,
    coincidencias: ["tarapoto", "jimenez pimentel", "morales", "la banda de shilcayo"],
  },
  {
    id: "moyobamba-centro",
    nombre: "Shalom Moyobamba",
    departamento: "San Martín",
    provincia: "Moyobamba",
    distrito: "Moyobamba",
    direccion: "Jr. 25 de Mayo 430",
    referencia: "Cerca a la Plaza de Armas",
    principal: true,
    coincidencias: ["moyobamba", "25 de mayo"],
  },

  // --- UCAYALI / PUCALLPA ---
  {
    id: "pucallpa-centenario",
    nombre: "Shalom Pucallpa",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Callería",
    direccion: "Av. Centenario Km 4.2",
    referencia: "Frente a Real Plaza Pucallpa / Yarinacocha",
    principal: true,
    coincidencias: ["pucallpa", "centenario", "calleria", "yarinacocha", "coronel portillo"],
  },

  // --- LORETO / IQUITOS ---
  {
    id: "iquitos-putumayo",
    nombre: "Shalom Iquitos",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "Iquitos",
    direccion: "Av. Putumayo 1420",
    referencia: "Cerca a Plaza 28 de Julio y Punchana",
    principal: true,
    coincidencias: ["iquitos", "putumayo", "maynas", "punchana", "san juan bautista iquitos", "belen iquitos"],
  },

  // --- AYACUCHO ---
  {
    id: "ayacucho-caceres",
    nombre: "Shalom Ayacucho (Huamanga)",
    departamento: "Ayacucho",
    provincia: "Huamanga",
    distrito: "Ayacucho",
    direccion: "Av. Mariscal Cáceres 1150",
    referencia: "Cerca al Mercado Magdalena",
    principal: true,
    coincidencias: ["ayacucho", "huamanga", "mariscal caceres", "san juan bautista ayacucho"],
  },

  // --- APURÍMAC (ABANCAY / ANDAHUAYLAS) ---
  {
    id: "abancay-arenas",
    nombre: "Shalom Abancay",
    departamento: "Apurímac",
    provincia: "Abancay",
    distrito: "Abancay",
    direccion: "Av. Arenas 420",
    referencia: "Cerca al Parque El Olivo",
    principal: true,
    coincidencias: ["abancay", "av arenas", "apurimac"],
  },
  {
    id: "andahuaylas-centro",
    nombre: "Shalom Andahuaylas",
    departamento: "Apurímac",
    provincia: "Andahuaylas",
    distrito: "Andahuaylas",
    direccion: "Av. Pedro Ruiz Gallo 510",
    referencia: "Cerca al Estadio Los Chankas",
    principal: true,
    coincidencias: ["andahuaylas", "ruiz gallo", "chankas"],
  },

  // --- MADRE DE DIOS (PUERTO MALDONADO) ---
  {
    id: "puerto-maldonado-centro",
    nombre: "Shalom Puerto Maldonado",
    departamento: "Madre de Dios",
    provincia: "Tambopata",
    distrito: "Tambopata",
    direccion: "Av. Madre de Dios 840",
    referencia: "Cerca al Mercado Modelo",
    principal: true,
    coincidencias: ["puerto maldonado", "madre de dios", "tambopata"],
  },

  // --- TUMBES ---
  {
    id: "tumbes-norte",
    nombre: "Shalom Tumbes",
    departamento: "Tumbes",
    provincia: "Tumbes",
    distrito: "Tumbes",
    direccion: "Av. Tumbes Norte 980",
    referencia: "Carretera Panamericana Norte",
    principal: true,
    coincidencias: ["tumbes", "tumbes norte", "zarumilla", "puerto pizarro"],
  },

  // --- LIMA PROVINCIAS (HUACHO, BARRANCA, CAÑETE, HUARAL) ---
  {
    id: "huacho-28-julio",
    nombre: "Shalom Huacho",
    departamento: "Lima Provincias",
    provincia: "Huaura",
    distrito: "Huacho",
    direccion: "Av. 28 de Julio 640",
    referencia: "Cerca al Óvalo de Huacho",
    principal: true,
    coincidencias: ["huacho", "huaura", "carquin", "santa maria huacho"],
  },
  {
    id: "barranca-galvez",
    nombre: "Shalom Barranca",
    departamento: "Lima Provincias",
    provincia: "Barranca",
    distrito: "Barranca",
    direccion: "Jr. José Gálvez 512",
    referencia: "Cerca al Parque Los Próceres",
    principal: true,
    coincidencias: ["barranca", "pativilca", "supe", "paramonga"],
  },
  {
    id: "canete-benavides",
    nombre: "Shalom Cañete (San Vicente)",
    departamento: "Lima Provincias",
    provincia: "Cañete",
    distrito: "San Vicente de Cañete",
    direccion: "Av. Mariscal Benavides 1020",
    referencia: "Cerca al Coliseo Lolo Fernández",
    principal: true,
    coincidencias: ["canete", "cañete", "san vicente de cañete", "imperial canete", "mala"],
  },
  {
    id: "huaral-centro",
    nombre: "Shalom Huaral",
    departamento: "Lima Provincias",
    provincia: "Huaral",
    distrito: "Huaral",
    direccion: "Av. Chancay 730",
    referencia: "Cerca a la Plaza Centenario",
    principal: true,
    coincidencias: ["huaral", "chancay", "plaza centenario huaral"],
  },
];

function normalizarTexto(txt: string | null | undefined): string {
  if (!txt) return "";
  return txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca y puntúa las agencias de Shalom más cercanas en base a ciudad, dirección o referencias.
 */
export function buscarAgenciaShalomCercana(params: {
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  referencia?: string | null;
}): {
  mejorOpcion: AgenciaShalom | null;
  otrasOpciones: AgenciaShalom[];
  propuestaMensaje: string | null;
} {
  const ciudadNorm = normalizarTexto(params.ciudad);
  const distritoNorm = normalizarTexto(params.distrito);
  const direccionNorm = normalizarTexto(params.direccion);
  const referenciaNorm = normalizarTexto(params.referencia);

  const todoJunto = [ciudadNorm, distritoNorm, direccionNorm, referenciaNorm].filter(Boolean).join(" ");
  if (!todoJunto.trim()) {
    return { mejorOpcion: null, otrasOpciones: [], propuestaMensaje: null };
  }

  // Puntuación de agencias
  const puntuadas = AGENCIAS_SHALOM_PERU.map((ag) => {
    let score = 0;
    const agCiudad = normalizarTexto(ag.provincia);
    const agDpto = normalizarTexto(ag.departamento);
    const agDist = normalizarTexto(ag.distrito);
    const agDir = normalizarTexto(ag.direccion);
    const agNom = normalizarTexto(ag.nombre);

    // 1. Coincidencia con la ciudad o provincia
    if (ciudadNorm && (agCiudad.includes(ciudadNorm) || ciudadNorm.includes(agCiudad))) {
      score += 40;
    }
    if (ciudadNorm && (agDpto.includes(ciudadNorm) || ciudadNorm.includes(agDpto))) {
      score += 30;
    }

    // 2. Coincidencia con distrito
    if (distritoNorm && (agDist.includes(distritoNorm) || distritoNorm.includes(agDist))) {
      score += 50;
    }

    // 3. Coincidencia específica en la dirección / calle / referencia
    if (direccionNorm || referenciaNorm) {
      for (const token of ag.coincidencias ?? []) {
        const tNorm = normalizarTexto(token);
        if (tNorm.length >= 3) {
          if (direccionNorm.includes(tNorm) || referenciaNorm.includes(tNorm) || todoJunto.includes(tNorm)) {
            score += 35;
          }
        }
      }
      // Coincidencia con partes de la dirección de la agencia (ej: "Santa Rosa", "Parra", "Bolognesi")
      const palabrasClave = agDir.split(" ").filter((w) => w.length > 4);
      for (const p of palabrasClave) {
        if (todoJunto.includes(p)) score += 25;
      }
    }

    // Puntos extra para agencia principal de la ciudad si no hay match hiper-específico
    if (ag.principal) {
      score += 5;
    }

    return { agencia: ag, score };
  })
    .filter((item) => item.score > 25)
    .sort((a, b) => b.score - a.score);

  if (puntuadas.length === 0) {
    return { mejorOpcion: null, otrasOpciones: [], propuestaMensaje: null };
  }

  const mejorOpcion = puntuadas[0].agencia;
  const otrasOpciones = puntuadas.slice(1, 4).map((p) => p.agencia);

  const zonaCliente = params.distrito || params.direccion || params.ciudad || "tu zona";
  const propuestaMensaje = `Me parece que la agencia Shalom más cercana para ti es la **${mejorOpcion.nombre}** (${mejorOpcion.direccion}). ¿Te gustaría que lo programemos a esa agencia o prefieres otra?`;

  return {
    mejorOpcion,
    otrasOpciones,
    propuestaMensaje,
  };
}
