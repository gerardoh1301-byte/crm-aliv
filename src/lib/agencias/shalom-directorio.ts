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
  curada?: boolean;
  coincidencias?: string[];
  /** Localidad de la agencia según el padrón oficial (p. ej. "BAJO PICHANAQUI", "SICUANI"). */
  zona?: string;
}

import { AGENCIAS_SHALOM_OFICIALES } from "./shalom-agencias-oficiales";

const AGENCIAS_CURADAS: AgenciaShalom[] = [
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
    id: "shalom-405-cvoa",
    nombre: "Shalom Ica - Av. J.J. Elías (Cutervo)",
    departamento: "Ica",
    provincia: "Ica",
    distrito: "Ica",
    direccion: "Manzana B, Sub-lote 02 del Fundo La Palma",
    referencia: "Cruce de Av. Cutervo con Av. J.J. Elías (Frente a Plaza del Sol)",
    principal: true,
    coincidencias: [
      "ica",
      "cutervo",
      "av cutervo",
      "jj elias",
      "j.j elias",
      "elias",
      "cvoa",
      "plaza del sol",
      "centro ica",
      "fundo la palma",
      "panamericana sur ica",
    ],
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
    id: "shalom-472-vla",
    nombre: "Shalom Pisco - La Villa (Cruce Pisco)",
    departamento: "Ica",
    provincia: "Pisco",
    distrito: "La Villa Cruce Pisco",
    direccion: "C. P. Población Villa Los Ángeles Mz. A Lt. 13 B La Villa",
    referencia: "A 100 metros al sur del cruce Panamericana Antigua con Av. Fermín Tangüis",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    principal: true,
    coincidencias: ["pisco", "la villa", "cruce pisco", "villa los angeles", "fermin tanguis", "panamericana antigua", "vla"],
  },
  {
    id: "shalom-56-pis",
    nombre: "Shalom Pisco - Centro (Av. Abraham Valdelomar)",
    departamento: "Ica",
    provincia: "Pisco",
    distrito: "Pisco",
    direccion: "Av. Abraham Valdelomar Nro. 965",
    referencia: "A 1 cuadra de la Posta San Martín",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["pisco", "pisco centro", "valdelomar", "abraham valdelomar", "posta san martin", "san andres pisco", "paracas", "pis"],
  },
  {
    id: "shalom-496-psc",
    nombre: "Shalom Pisco - San Clemente",
    departamento: "Ica",
    provincia: "Pisco",
    distrito: "San Clemente",
    direccion: "Av. Los Libertadores Mz. 91 Lt. 7ª",
    referencia: "Frente al Grifo Santa Rosa",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 7:00 PM",
    coincidencias: ["san clemente", "libertadores", "grifo santa rosa", "pisco norte", "psc"],
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
    id: "pucallpa-galvez",
    nombre: "Shalom Pucallpa - Callería (Jr. José Gálvez)",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Callería",
    direccion: "Jr. José Gálvez 147",
    referencia: "A media cuadra de Av. Centenario / Cerca a Plaza de Armas",
    principal: true,
    coincidencias: ["pucallpa", "jose galvez", "galvez", "calleria", "centro pucallpa", "coronel portillo"],
  },
  {
    id: "pucallpa-saenz-pena",
    nombre: "Shalom Pucallpa - Callería (Av. Sáenz Peña)",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Callería",
    direccion: "Av. Sáenz Peña 229",
    referencia: "Cerca al Óvalo Federico Basadre y Sáenz Peña",
    coincidencias: ["saenz pena", "ovalo basadre", "federico basadre", "pucallpa saenz"],
  },
  {
    id: "pucallpa-centenario",
    nombre: "Shalom Pucallpa - Av. Centenario (Real Plaza)",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Callería",
    direccion: "Av. Centenario Km 4.2",
    referencia: "Frente a Real Plaza Pucallpa",
    coincidencias: ["centenario", "real plaza pucallpa", "km 4.2", "km 4", "centenario pucallpa"],
  },
  {
    id: "pucallpa-yarinacocha",
    nombre: "Shalom Pucallpa - Yarinacocha",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Yarinacocha",
    direccion: "Av. Universitaria Mz. A Lt. 6",
    referencia: "Cerca a Laguna de Yarinacocha y Plaza Principal",
    coincidencias: ["yarinacocha", "universitaria", "laguna yarinacocha", "puerto callao"],
  },
  {
    id: "pucallpa-manantay",
    nombre: "Shalom Pucallpa - Manantay",
    departamento: "Ucayali",
    provincia: "Coronel Portillo",
    distrito: "Manantay",
    direccion: "Av. Aguaytía Mz. 26 Lt. 20",
    referencia: "A media cuadra del Nuevo Mercado San Fernando / Av. Túpac Amaru",
    coincidencias: ["manantay", "aguaytia", "mercado san fernando", "san fernando", "tupac amaru pucallpa"],
  },

  // --- LORETO / IQUITOS ---
  {
    id: "shalom-460-iqcojrbol",
    nombre: "Shalom Iquitos - Jr. Francisco Bolognesi",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "Iquitos",
    direccion: "Jr. Francisco Bolognesi #941 con Jr. Bermúdez",
    referencia: "Frente a la Universidad Nacional de la Amazonía Peruana (UNAP)",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    principal: true,
    coincidencias: ["iquitos", "bolognesi", "francisco bolognesi", "bermudez", "unap", "maynas", "iqcojrbol"],
  },
  {
    id: "shalom-52-iqjrpab",
    nombre: "Shalom Iquitos - Jr. Pablo Rossel",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "Iquitos",
    direccion: "Jr. Pablo Rossel 590 con Nanay",
    referencia: "Frente al CETPRO American Computer",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["pablo rossel", "nanay", "american computer", "iquitos centro", "iqjrpab"],
  },
  {
    id: "shalom-624-iqits",
    nombre: "Shalom Iquitos - Av. Túpac Amaru",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "Iquitos",
    direccion: "Av. Túpac Amaru con Calle Lourdes de León #479",
    referencia: "Frente a la Botica Thiagofarma",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["tupac amaru", "lourdes de leon", "thiagofarma", "iqits"],
  },
  {
    id: "shalom-536-avjsqns",
    nombre: "Shalom Iquitos - San Juan Bautista (Av. Quiñones)",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "San Juan Bautista",
    direccion: "Av. José Abelardo Quiñones #2475",
    referencia: "Frente a la Universidad Científica del Perú (UCP)",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["san juan bautista", "quiñones", "abelardo quiñones", "ucp", "avjsqns"],
  },
  {
    id: "shalom-473-sjba",
    nombre: "Shalom Iquitos - San Juan Bautista (Av. Participación)",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "San Juan Bautista",
    direccion: "Av. Participación Parcela 9-A",
    referencia: "Frente al Lavadero Osito y a media cuadra del Parque 1 de Enero",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["participacion", "parque 1 de enero", "lavadero osito", "sjba"],
  },
  {
    id: "shalom-497-pchna",
    nombre: "Shalom Punchana",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "Punchana",
    direccion: "Calle Borja N° 648",
    referencia: "Al costado de la Farmacia San Carlos Centro Médico",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["punchana", "calle borja", "borja", "farmacia san carlos", "pchna"],
  },
  {
    id: "shalom-678-ctraiqts",
    nombre: "Shalom Iquitos - Carretera Iquitos Nauta",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "San Juan Bautista",
    direccion: "Carretera Iquitos Nauta S/N Mz. K Lt. 20",
    referencia: "Al costado de la distribuidora Amazon Gas",
    telefono: "(01) 500 7878",
    horario: "Lunes a Viernes - 8:00 AM a 8:00 PM",
    coincidencias: ["carretera iquitos nauta", "iquitos nauta", "amazon gas", "ctraiqts"],
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

function capitalizarPalabra(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** true si `palabra` aparece como palabra(s) completa(s) dentro de `texto` (ambos normalizados). */
function contienePalabra(texto: string, palabra: string): boolean {
  if (!texto || !palabra) return false;
  return ` ${texto} `.includes(` ${palabra} `);
}

/** "Lima Provincias" y "Lima" son el mismo departamento para filtrar. */
function normalizarDepartamento(d: string | null | undefined): string {
  return normalizarTexto(d).replace(/ provincias?$/, "");
}

function normalizarDireccionClave(dir: string): string {
  return (dir || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(nro|n|numero|s\/n|sn|mz|lt|lote|manzana|km)\b/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Construye el padrón maestro combinando las agencias curadas con el directorio
 * oficial de más de 500 agencias de Shalom a nivel nacional en todo el Perú.
 */
/**
 * Agencias curadas a mano que NO están en el padrón oficial de Shalom (revisado el 20/11).
 * "pucallpa-centenario" (Av. Centenario Km 4.2) se le propuso a un cliente y su pedido
 * salió a otra sede. No se proponen más; esas ciudades quedan cubiertas por sus sedes
 * oficiales.
 */
export const CURADAS_SIN_PADRON_OFICIAL = new Set([
  "sullana-jose-de-lama", "talara-centro", "chiclayo-bolognesi", "arequipa-bustamante", "arequipa-cayma",
  "nazca-centro", "ilo-puerto", "moquegua-centro", "cajamarca-evitamiento", "jaen-pakamuros",
  "tingo-maria-raimondi", "moyobamba-centro", "pucallpa-centenario", "ayacucho-caceres", "abancay-arenas",
  "andahuaylas-centro", "puerto-maldonado-centro", "huacho-28-julio",
]);

function construirPadronCompleto(): AgenciaShalom[] {
  const padron: AgenciaShalom[] = AGENCIAS_CURADAS.filter((ag) => !CURADAS_SIN_PADRON_OFICIAL.has(ag.id)).map((ag) => ({
    ...ag,
    curada: true,
  }));

  // Clave de duplicado: distrito + inicio de la dirección. Solo la dirección no basta:
  // "CARRETERA CENTRAL..." se repite en varias ciudades y se perdían agencias (Carhuaz, Huari...).
  const claveDup = (distrito: string, direccion: string) =>
    `${normalizarDireccionClave(distrito)}|${normalizarDireccionClave(direccion).slice(0, 15)}`;
  const direccionesExistentes = new Set(AGENCIAS_CURADAS.map((a) => claveDup(a.distrito, a.direccion)));

  for (const ofc of AGENCIAS_SHALOM_OFICIALES) {
    const dirNorm = claveDup(ofc.distrito, ofc.direccion);
    if (!direccionesExistentes.has(dirNorm)) {
      const zonaCap = capitalizarPalabra(ofc.zona || ofc.distrito || ofc.provincia);
      const dirCap = capitalizarPalabra(ofc.direccion.split(",")[0]);

      padron.push({
        id: ofc.id,
        nombre: `Shalom ${zonaCap} - ${dirCap}`,
        departamento: capitalizarPalabra(ofc.departamento),
        provincia: capitalizarPalabra(ofc.provincia),
        distrito: capitalizarPalabra(ofc.distrito),
        direccion: ofc.direccion,
        referencia: ofc.referencia,
        telefono: ofc.telefono || "(01) 500 7878",
        horario: ofc.horario || "LUNES A VIERNES - 8AM A 8PM",
        principal: false,
        coincidencias: ofc.coincidencias || [],
        zona: ofc.zona,
      });
      direccionesExistentes.add(dirNorm);
    }
  }

  return padron;
}

export const AGENCIAS_SHALOM_PERU: AgenciaShalom[] = construirPadronCompleto();

export interface ResultadoBusquedaAgenciaShalom {
  mejorOpcion: AgenciaShalom | null;
  otrasOpciones: AgenciaShalom[];
  propuestaMensaje: string | null;
  multiplesAgenciasEnCiudad?: boolean;
  ciudadDetectada?: string | null;
  todasDeCiudad?: AgenciaShalom[];
}

/**
 * Busca y puntúa las agencias de Shalom más cercanas en base a ciudad, dirección o referencias.
 */
export function buscarAgenciaShalomCercana(params: {
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  referencia?: string | null;
}): ResultadoBusquedaAgenciaShalom {
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

    // 1. Coincidencia con la ciudad o provincia (soporta nombres de capitales como Pucallpa / Coronel Portillo, Juliaca / San Román, etc.)
    const agCoincidenciasNorm = (ag.coincidencias ?? []).map(normalizarTexto);
    const matchCiudad =
      (ciudadNorm && (
        contienePalabra(agCiudad, ciudadNorm) ||
        contienePalabra(ciudadNorm, agCiudad) ||
        agCoincidenciasNorm.includes(ciudadNorm)
      )) ||
      new RegExp(`\\b${agCiudad}\\b`, "i").test(todoJunto) ||
      agCoincidenciasNorm.some((c) => c.length >= 4 && new RegExp(`\\b${c}\\b`, "i").test(todoJunto));

    const matchDpto =
      (ciudadNorm && (contienePalabra(agDpto, ciudadNorm) || contienePalabra(ciudadNorm, agDpto))) ||
      new RegExp(`\\b${agDpto}\\b`, "i").test(todoJunto);

    // La localidad oficial de la agencia (zona) identifica la ciudad mejor que la provincia:
    // "Sicuani", "Pichanaqui", "Huamachuco" son zonas, no provincias.
    const agZona = normalizarTexto(ag.zona);
    const matchZona =
      Boolean(ciudadNorm) &&
      ((agZona.length >= 3 && agZona === ciudadNorm) ||
        (agZona.length >= 3 && ciudadNorm.length >= 4 && contienePalabra(agZona, ciudadNorm)) ||
        (agZona.length >= 4 && contienePalabra(ciudadNorm, agZona)) ||
        normalizarTexto(ag.distrito) === ciudadNorm ||
        normalizarTexto(ag.provincia) === ciudadNorm);

    if (matchCiudad) score += 40;
    if (matchDpto) score += 20;
    if (matchZona) score += 70;

    // 2. Coincidencia con distrito específico (alta prioridad para no enviar al centro a quien vive en otro distrito)
    const matchDistrito =
      (distritoNorm && (contienePalabra(agDist, distritoNorm) || contienePalabra(distritoNorm, agDist))) ||
      // En el padrón oficial el distrito real suele estar en la zona ("CAYMA"), no en el
      // campo distrito (que es el nombre de la sede: "AV CHARCANI").
      (distritoNorm.length >= 4 && agZona.length >= 4 && agZona !== ciudadNorm &&
        (contienePalabra(agZona, distritoNorm) || contienePalabra(distritoNorm, agZona))) ||
      (agDist.length >= 4 && agDist !== agCiudad && todoJunto.includes(agDist));
    if (matchDistrito) {
      score += 60;
    }

    // 3. Coincidencia específica en la dirección / calle / referencia / tokens de zona
    for (const token of ag.coincidencias ?? []) {
      const tNorm = normalizarTexto(token);
      if (tNorm.length >= 3 && todoJunto.includes(tNorm)) {
        // Si el token coincide con la ciudad o dpto, o con la ciudad buscada por el usuario
        if (tNorm === agCiudad || tNorm === agDpto || (ciudadNorm && tNorm.includes(ciudadNorm)) || (ciudadNorm && ciudadNorm.includes(tNorm))) {
          score += 10;
        } else {
          score += 45;
        }
      }
    }

    // Coincidencia con partes de la dirección de la agencia (ej: "Santa Rosa", "Parra", "Bolognesi")
    const palabrasClave = agDir.split(" ").filter((w) => w.length > 4);
    for (const p of palabrasClave) {
      if (p === agCiudad || p === agDpto || p === agDist || agDist.includes(p) || agCiudad.includes(p)) continue;
      if (todoJunto.includes(p)) score += 25;
    }

    // Puntos extra para agencias curadas con datos y aliases verificados, SOLO si ya hay
    // una coincidencia geográfica. Antes se sumaba siempre y, para una ciudad sin match,
    // ganaba la primera curada (Sullana) aunque el cliente estuviera en Cusco o Amazonas.
    const tieneMatchGeografico = matchCiudad || matchZona || matchDistrito;
    if (ag.curada && tieneMatchGeografico) {
      score += 60;
    }

    // Puntos extra para agencia principal de la ciudad como desempate si no hay match de zona
    if (ag.principal) {
      score += 10;
    }

    return { agencia: ag, score };
  })
    .filter((item) => item.score > 25)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.agencia.curada && !a.agencia.curada) return 1;
      if (a.agencia.curada && !b.agencia.curada) return -1;
      return 0;
    });

  // Si la ciudad que dio el cliente es una localidad exacta del padrón (zona, distrito o
  // provincia), solo valen agencias de ese departamento: así "Cutervo" no cae en la Av.
  // Cutervo de Ica ni "Huanta" en Anta (Cusco).
  if (ciudadNorm) {
    const dptosExactos = new Set(
      AGENCIAS_SHALOM_PERU.filter(
        (ag) =>
          normalizarTexto(ag.zona) === ciudadNorm ||
          normalizarTexto(ag.distrito) === ciudadNorm ||
          normalizarTexto(ag.provincia) === ciudadNorm
      ).map((ag) => normalizarDepartamento(ag.departamento))
    );
    if (dptosExactos.size > 0) {
      const enDpto = puntuadas.filter((p) => dptosExactos.has(normalizarDepartamento(p.agencia.departamento)));
      if (enDpto.length > 0) puntuadas.splice(0, puntuadas.length, ...enDpto);
    }
  }

  if (puntuadas.length === 0) {
    return { mejorOpcion: null, otrasOpciones: [], propuestaMensaje: null };
  }

  const mejorOpcion = puntuadas[0].agencia;
  const otrasOpciones = puntuadas.slice(1, 4).map((p) => p.agencia);

  // Detectar si la ciudad/provincia tiene múltiples agencias y el cliente NO especificó calle o distrito puntual
  const agCiudadNorm = normalizarTexto(mejorOpcion.provincia);
  const agDistNorm = normalizarTexto(mejorOpcion.distrito);
  const todasDeCiudad = AGENCIAS_SHALOM_PERU.filter((ag) => {
    const p = normalizarTexto(ag.provincia);
    const dist = normalizarTexto(ag.distrito);
    const c = (ag.coincidencias || []).map(normalizarTexto);

    if (ciudadNorm) {
      const nombreNorm = normalizarTexto(ag.nombre);
      return c.includes(ciudadNorm) || p === ciudadNorm || dist === ciudadNorm || nombreNorm.includes(ciudadNorm);
    }
    return p === agCiudadNorm || (dist && dist === agDistNorm);
  });

  const hayMultiples = todasDeCiudad.length > 1;
  const dioUbicacionEspecifica = Boolean(
    (distritoNorm && distritoNorm !== agCiudadNorm && distritoNorm.length >= 4) ||
    (direccionNorm && direccionNorm.length > 8 && !direccionNorm.includes(agCiudadNorm)) ||
    (direccionNorm && puntuadas.length > 1 && (puntuadas[0].score - puntuadas[1].score) >= 20) ||
    (direccionNorm && puntuadas.length > 0 && puntuadas[0].score >= 70)
  );

  const esAmbiguo = hayMultiples && !dioUbicacionEspecifica;

  let propuestaMensaje: string;
  if (hayMultiples && esAmbiguo) {
    const ciudadNombre = params.ciudad || mejorOpcion.provincia || mejorOpcion.departamento;
    // Mostrar hasta 6 opciones para no saturar el mensaje de WhatsApp si la ciudad tiene muchas sedes
    const opcionesAMostrar = todasDeCiudad.slice(0, 6);
    const listaOpciones = opcionesAMostrar
      .map((a) => `• *${a.nombre}* (${a.direccion}${a.referencia ? ` - ref: ${a.referencia}` : ""})`)
      .join("\n");
    const extraTxt = todasDeCiudad.length > 6 ? `\n(Y ${todasDeCiudad.length - 6} agencias más en la zona)` : "";
    propuestaMensaje = `En ${ciudadNombre} contamos con varias agencias de Shalom. ¿A cuál de ellas te queda más cómodo recoger tu pedido?\n${listaOpciones}${extraTxt}\n¿Cuál de ellas te queda más cerca?`;
  } else {
    const refTxt = mejorOpcion.referencia ? ` (ref: ${mejorOpcion.referencia})` : "";
    propuestaMensaje = `Me parece que la agencia Shalom más cercana a tu dirección es *${mejorOpcion.nombre}* (${mejorOpcion.direccion}${refTxt}). ¿Te parece bien que lo programemos a esa agencia o prefieres otra?`;
  }

  return {
    mejorOpcion,
    otrasOpciones,
    propuestaMensaje,
    multiplesAgenciasEnCiudad: hayMultiples && esAmbiguo,
    ciudadDetectada: params.ciudad || mejorOpcion.provincia || mejorOpcion.departamento,
    todasDeCiudad: hayMultiples ? todasDeCiudad : [mejorOpcion],
  };
}

// ---------------------------------------------------------------------------
// Resolución estricta: ¿la agencia que dio el cliente existe en el directorio oficial?

/** Palabras que no identifican una calle concreta. */
const PALABRAS_GENERICAS = new Set([
  "avenida", "jiron", "calle", "carretera", "ctra", "mza", "lote", "pasaje", "psje", "sector",
  "agencia", "shalom", "frente", "costado", "altura", "cuadra", "cdra", "entre", "esquina",
  "asentamiento", "humano", "urbanizacion", "peru", "norte", "oeste", "centro", "principal",
  "prolongacion", "espalda", "cerca", "local", "tienda", "oficina", "sede",
]);

/** Vías con dos nombres en la misma ciudad (en Pucallpa, Av. Centenario = Carretera Federico Basadre). */
const SINONIMOS_VIA: Array<{ zona: RegExp; nombres: string[] }> = [
  { zona: /pucallpa|yarinacocha|ucayali|coronel portillo|calleria|manantay/, nombres: ["centenario", "federico basadre"] },
];

function kilometros(texto: string | null | undefined): number[] {
  const out: number[] = [];
  const re = /km\.?\s*(\d+(?:[.,]\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto || ""))) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export interface ResolucionAgenciaOficial {
  /** La agencia del padrón OFICIAL de Shalom que corresponde, o null si no hay una sola segura. */
  agencia: AgenciaShalom | null;
  /** Opciones reales (padrón oficial) para preguntarle al cliente cuando no hay certeza. */
  opciones: AgenciaShalom[];
  motivo: "exacta" | "no_encontrada" | "ambigua" | "km_distinto";
}

/**
 * Padrón oficial de Shalom (569 sedes) con el nombre de la sede tal como sale en la guía
 * ("YARINACOCHA CENTRO", "ICA AV. JJ ELIAS"). Las agencias curadas a mano no cuentan: una
 * de ellas ("Av. Centenario Km 4.2", Pucallpa) no existe en el padrón y mandó mal un pedido.
 */
const PADRON_OFICIAL: AgenciaShalom[] = AGENCIAS_SHALOM_OFICIALES.map((o) => ({
  id: o.id,
  nombre: `Shalom ${capitalizarPalabra(o.distrito || o.zona || o.provincia)}`,
  departamento: capitalizarPalabra(o.departamento),
  provincia: capitalizarPalabra(o.provincia),
  distrito: capitalizarPalabra(o.distrito),
  direccion: o.direccion,
  referencia: o.referencia,
  horario: o.horario,
  coincidencias: o.coincidencias || [],
  zona: o.zona,
}));

/** Texto canónico para guardar en el pedido: "Agencia Shalom <sede> (<dirección> · ref: ...)". */
export function textoAgenciaOficial(ag: AgenciaShalom): string {
  const ref = (ag.referencia || "").replace(/^[\s:]+/, "").trim();
  return `Agencia ${ag.nombre} (${ag.direccion.trim()}${ref ? ` · ref: ${ref}` : ""})`;
}

/**
 * Decide si lo que dijo el cliente ("Av. Centenario Km 6.800", "Shalom Yarinacocha Centro",
 * "agencia de Cutervo") corresponde a UNA sede del padrón oficial. Exige que coincida la
 * calle, la referencia o el nombre de la sede (no basta la ciudad) y, si ambos dan
 * kilómetro, que sea el mismo: "Centenario Km 4.2" no es la sede del Km 6.800.
 */
export function resolverAgenciaOficial(params: {
  texto: string | null | undefined;
  ciudad?: string | null;
}): ResolucionAgenciaOficial {
  const crudo = `${params.texto || ""} ${params.ciudad || ""}`;
  let norm = ` ${normalizarTexto(crudo)} `;
  for (const s of SINONIMOS_VIA) {
    if (s.zona.test(norm) && s.nombres.some((n) => norm.includes(n))) norm += ` ${s.nombres.join(" ")} `;
  }
  const kmCliente = kilometros(params.texto);
  const ciudadNorm = normalizarTexto(params.ciudad);
  const palabrasCiudad = ciudadNorm.split(" ").filter((w) => w.length >= 4);

  // Sedes de la zona: la ciudad del cliente aparece en su ubicación oficial.
  const enZona = PADRON_OFICIAL.filter((ag) => {
    const ubic = ` ${normalizarTexto([ag.departamento, ag.provincia, ag.zona, ag.distrito, ag.direccion].join(" "))} `;
    return palabrasCiudad.length ? palabrasCiudad.some((w) => ubic.includes(` ${w} `)) : true;
  });

  let kmDistinto = false;
  const evaluadas = enZona
    .map((ag) => {
      const lugar = new Set(
        [ag.zona, ag.provincia, ag.departamento, params.ciudad].flatMap((t) => normalizarTexto(t).split(" ")).filter(Boolean)
      );
      const sede = normalizarTexto(ag.distrito);
      const distintivas = normalizarTexto(`${ag.direccion} ${ag.referencia || ""} ${sede}`)
        .split(" ")
        .filter((w) => w.length >= 4 && !/\d/.test(w) && !PALABRAS_GENERICAS.has(w) && !lugar.has(w));
      const coincideCalle = distintivas.some((w) => norm.includes(` ${w} `));
      const coincideSede = sede.split(" ").length >= 2 && norm.includes(` ${sede} `);

      const kmAgencia = kilometros(`${ag.direccion} ${ag.referencia || ""}`);
      // Si el cliente dio un kilómetro, la sede tiene que estar en ese mismo kilómetro.
      const kmOk = !kmCliente.length || kmCliente.some((k) => kmAgencia.some((a) => Math.abs(a - k) < 0.05));
      if ((coincideCalle || coincideSede) && !kmOk) kmDistinto = true;

      const tokensNumericos = normalizarTexto(ag.direccion)
        .split(" ")
        .filter((w) => /\d/.test(w) && /[a-z]/.test(w) && w.length >= 2);
      const desempate =
        distintivas.filter((w) => norm.includes(` ${w} `)).length +
        tokensNumericos.filter((t) => norm.includes(` ${t} `)).length * 2 +
        (coincideSede ? 3 : 0) +
        (kmCliente.length && kmAgencia.length && kmOk ? 3 : 0);
      return { ag, segura: (coincideCalle || coincideSede) && kmOk, desempate };
    })
    .filter((e) => e.segura)
    .sort((a, b) => b.desempate - a.desempate);

  const opciones = (evaluadas.length ? evaluadas.map((e) => e.ag) : enZona).slice(0, 6);
  if (evaluadas.length === 1 || (evaluadas.length > 1 && evaluadas[0].desempate > evaluadas[1].desempate)) {
    return { agencia: evaluadas[0].ag, opciones, motivo: "exacta" };
  }
  if (evaluadas.length > 1) return { agencia: null, opciones, motivo: "ambigua" };
  return { agencia: null, opciones: palabrasCiudad.length ? opciones : [], motivo: kmDistinto ? "km_distinto" : "no_encontrada" };
}
