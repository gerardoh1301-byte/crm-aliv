/**
 * Matriz oficial de cobertura de Contra Entrega a Provincia de AliClik
 * Obtenida y validada directamente desde la API oficial de AliClik (/city-coverage).
 * Permite pago contra entrega directo a domicilio en las principales ciudades de provincia.
 */

export interface CoberturaDistrito {
  departamento: string;
  provincia: string;
  distrito: string;
}

export const COBERTURA_CONTRAENTREGA_PROVINCIA: Record<string, Record<string, string[]>> = {
  Piura: {
    Paita: ["Paita"],
    Sullana: ["Sullana"],
    Talara: ["Pariñas", "Talara"],
    Piura: ["Piura", "Castilla", "Veintiséis de Octubre", "26 de Octubre"],
  },
  Ica: {
    Chincha: ["Chincha Alta", "Chincha"],
    Pisco: ["Pisco"],
    Ica: [
      "Ica",
      "La Tinguiña",
      "Los Aquijes",
      "Parcona",
      "Pueblo Nuevo",
      "San Juan Bautista",
      "Subtanjalla",
    ],
  },
  Ucayali: {
    "Coronel Portillo": ["Pucallpa", "Yarinacocha"],
  },
  Tacna: {
    Tacna: [
      "Tacna",
      "Alto de la Alianza",
      "Calana",
      "Ciudad Nueva",
      "Pachia",
      "Pocollay",
      "Cor Gregorio Albarracín",
      "Gregorio Albarracín",
    ],
  },
  "San Martin": {
    Lamas: ["Lamas", "Rumisapa", "Tarapoto", "Cacatachi"],
    "San Martin": ["Lamas", "Rumisapa", "Tarapoto", "Cacatachi", "Morales", "La Banda de Shilcayo"],
  },
  Puno: {
    "San Roman": ["Juliaca", "Caracoto"],
    Puno: ["Puno"],
  },
  "La Libertad": {
    Trujillo: [
      "Trujillo",
      "El Porvenir",
      "Florencia de Mora",
      "Huanchaco",
      "La Esperanza",
      "Laredo",
      "Moche",
      "Salaverry",
      "Victor Larco Herrera",
    ],
  },
  Junin: {
    Huancayo: [
      "Huancayo",
      "Chilca",
      "El Tambo",
      "Hualhuas",
      "Huancan",
      "Huayucachi",
      "Pariahuanca",
      "Pilcomayo",
      "Pucara",
      "Quilcas",
      "San Agustin",
      "San Jeronimo de Tunan",
      "Sapallanga",
      "Sicaya",
      "Viques",
      "Chupaca",
      "Chongos Bajo",
      "Huamancaca Chico",
      "Tres de Diciembre",
    ],
    Chupaca: [
      "Huancayo",
      "Chilca",
      "El Tambo",
      "Chupaca",
      "Chongos Bajo",
      "Huamancaca Chico",
      "Tres de Diciembre",
    ],
  },
  Huanuco: {
    Huanuco: ["Huanuco", "Amarilis", "Pillcomarca"],
  },
  Cusco: {
    Cusco: [
      "Cusco",
      "Ccorca",
      "Poroy",
      "San Jeronimo",
      "San Sebastian",
      "Santiago",
      "Saylla",
      "Wanchaq",
      "Anta",
      "Cachimayo",
      "Calca",
      "Pisac",
      "Urcos",
      "Andahuaylillas",
      "Lucre",
      "Oropesa",
      "Urubamba",
      "Maras",
    ],
  },
  Cajamarca: {
    Cajamarca: ["Cajamarca", "Los Baños del Inca"],
  },
  Ayacucho: {
    Huamanga: ["Ayacucho", "San Juan Bautista", "Jesús Nazareno", "Huamanga"],
  },
  Arequipa: {
    Arequipa: [
      "Arequipa",
      "Alto Selva Alegre",
      "Cayma",
      "Cerro Colorado",
      "Characato",
      "Jacobo Hunter",
      "Mariano Melgar",
      "Miraflores",
      "Paucarpata",
      "Sabandia",
      "Sachaca",
      "Socabaya",
      "Tiabaya",
      "Yanahuara",
      "Jose Luis Bustamante y Rivero",
      "JL Bustamante y Rivero",
    ],
  },
  Moquegua: {
    "Mariscal Nieto": ["Moquegua", "Samegua"],
    Ilo: ["Ilo", "El Algarrobal", "Pacocha"],
  },
  "Madre de Dios": {
    Tambopata: ["Tambopata", "Puerto Maldonado"],
  },
  Loreto: {
    Maynas: ["Iquitos"],
  },
  Apurimac: {
    Abancay: ["Abancay"],
  },
  Ancash: {
    Santa: ["Chimbote", "Coishco", "Nuevo Chimbote"],
    Huaraz: ["Huaraz", "Independencia", "Carhuaz", "Caraz", "Huaylas", "Yungay"],
  },
  Lambayeque: {
    Chiclayo: [
      "Chiclayo",
      "Jose Leonardo Ortiz",
      "La Victoria",
      "Monsefu",
      "Pimentel",
      "Reque",
      "Santa Rosa",
      "Pomalca",
      "Tumán",
      "Lambayeque",
      "Caleta San Jose",
      "San Jose - Ciudad de Dios",
    ],
    Lambayeque: [
      "Chiclayo",
      "Jose Leonardo Ortiz",
      "La Victoria",
      "Lambayeque",
    ],
  },
};

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Verifica si una dirección o ubicación tiene cobertura de Pago Contra Entrega en Provincia.
 */
export function tieneCoberturaContraEntregaProvincia(
  textoUbicacion: string
): { cubierto: boolean; ciudadDetectada?: string; detalle?: string } {
  const norm = normalizar(textoUbicacion);

  for (const [dept, provs] of Object.entries(COBERTURA_CONTRAENTREGA_PROVINCIA)) {
    for (const [prov, dists] of Object.entries(provs)) {
      for (const dist of dists) {
        const normDist = normalizar(dist);
        const normProv = normalizar(prov);
        const normDept = normalizar(dept);

        if (
          norm.includes(normDist) ||
          (norm.includes(normProv) && normDist === normProv) ||
          (norm.includes(normDept) && normDist === normDept)
        ) {
          return {
            cubierto: true,
            ciudadDetectada: `${dist} (${prov}, ${dept})`,
            detalle: `Cobertura activa con AliClik contra entrega a domicilio en ${dist}`,
          };
        }
      }
    }
  }

  return { cubierto: false };
}
