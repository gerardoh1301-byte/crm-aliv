import { describe, expect, it } from "vitest";
import {
  abandonoEnCurso,
  armarMensaje,
  decidirAccion,
  describirPack,
  normalizarCelularPe,
  primerNombre,
  unidadesPorTotal,
  type EstadoAbandono,
} from "@/lib/abandonos/reglas";

const base = new Date("2026-11-20T15:00:00Z"); // 10:00 en Lima
const min = (n: number) => new Date(base.getTime() + n * 60_000);
const hrs = (n: number) => new Date(base.getTime() + n * 3_600_000);

function estado(over: Partial<EstadoAbandono> = {}): EstadoAbandono {
  return {
    tags: ["formulario_abandonado"],
    capturadoEn: base,
    paso1En: null,
    paso2En: null,
    respondioDespues: false,
    pedidoDespues: false,
    horaLima: 10,
    ...over,
  };
}

describe("normalizarCelularPe", () => {
  it("acepta los formatos que escribe la gente", () => {
    expect(normalizarCelularPe("987 654 321")).toBe("+51987654321");
    expect(normalizarCelularPe("+51 987-654-321")).toBe("+51987654321");
    expect(normalizarCelularPe("51987654321")).toBe("+51987654321");
    expect(normalizarCelularPe("0051987654321")).toBe("+51987654321");
  });
  it("rechaza fijos, incompletos y relleno", () => {
    expect(normalizarCelularPe("014567890")).toBeNull();
    expect(normalizarCelularPe("98765432")).toBeNull();
    expect(normalizarCelularPe("999999999")).toBeNull();
    expect(normalizarCelularPe(undefined)).toBeNull();
  });
});

describe("packs", () => {
  it("deduce unidades por el total oficial", () => {
    expect(unidadesPorTotal("nac600", 119)).toBe(1);
    expect(unidadesPorTotal("nac600", 189)).toBe(2);
    expect(unidadesPorTotal("nac600", 199)).toBe(3);
    expect(unidadesPorTotal("termix", 79)).toBe(1);
    expect(unidadesPorTotal("termix", 139)).toBe(2);
    expect(unidadesPorTotal("termix", 189)).toBe(3);
    expect(describirPack("nac600", 199)).toBe("3 frascos de NAC600");
    expect(describirPack("termix", 79)).toBe("1 Tobillera Termix");
  });
});

describe("decidirAccion", () => {
  it("espera 30 minutos antes del primer mensaje", () => {
    expect(decidirAccion(estado(), min(29)).accion).toBe("esperar");
    expect(decidirAccion(estado(), min(31)).accion).toBe("paso1");
  });

  it("no escribe de noche y retoma en horario", () => {
    expect(decidirAccion(estado({ horaLima: 22 }), min(40)).accion).toBe("esperar");
    expect(decidirAccion(estado({ horaLima: 9 }), min(40)).accion).toBe("paso1");
  });

  it("un abandono de madrugada no recibe primer mensaje pasado el límite de 20 h", () => {
    expect(decidirAccion(estado(), hrs(21)).accion).toBe("cerrar");
  });

  it("si compra o responde, corta la secuencia antes de escribir", () => {
    expect(decidirAccion(estado({ pedidoDespues: true }), min(40)).accion).toBe("recuperado");
    expect(decidirAccion(estado({ respondioDespues: true }), min(40)).accion).toBe("respondio");
    expect(decidirAccion(estado({ pedidoDespues: true, respondioDespues: true }), min(40)).accion).toBe("recuperado");
  });

  it("segundo mensaje a las 24 h del primero y cierre 48 h después", () => {
    const tras1 = estado({ tags: ["formulario_abandonado", "abandono_paso1"], paso1En: min(31) });
    expect(decidirAccion(tras1, hrs(20)).accion).toBe("esperar");
    expect(decidirAccion(tras1, hrs(25)).accion).toBe("paso2");
    const tras2 = estado({
      tags: ["formulario_abandonado", "abandono_paso1", "abandono_paso2"],
      paso1En: min(31),
      paso2En: hrs(25),
    });
    expect(decidirAccion(tras2, hrs(60)).accion).toBe("esperar");
    expect(decidirAccion(tras2, hrs(74)).accion).toBe("cerrar");
  });

  it("nunca hace nada con una secuencia terminada", () => {
    for (const fin of ["abandono_respondio", "abandono_recuperado", "abandono_cerrado"]) {
      expect(decidirAccion(estado({ tags: ["formulario_abandonado", fin] }), hrs(30)).accion).toBe("esperar");
    }
  });
});

describe("abandonoEnCurso", () => {
  it("solo mientras no termine", () => {
    expect(abandonoEnCurso(["formulario_abandonado"])).toBe(true);
    expect(abandonoEnCurso(["formulario_abandonado", "abandono_paso1"])).toBe(true);
    expect(abandonoEnCurso(["formulario_abandonado", "abandono_respondio"])).toBe(false);
    expect(abandonoEnCurso(["shopify"])).toBe(false);
  });
});

describe("mensajes", () => {
  it("usa el primer nombre real y la plantilla con variables en orden", () => {
    const m = armarMensaje("paso1", { nombre: "rosa elena quispe", producto: "nac600", total: 199 });
    expect(m.texto).toContain("Hola Rosa");
    expect(m.texto).toContain("3 frascos de NAC600 por S/199.00");
    expect(m.plantilla).toEqual({
      name: "aliv_formulario_incompleto",
      language: "es",
      params: ["Rosa", "3 frascos de NAC600", "199.00"],
    });
  });
  it("no usa alias como nombre", () => {
    expect(primerNombre("Web 4321")).toBeNull();
    expect(primerNombre("WhatsApp 1234")).toBeNull();
    const m = armarMensaje("paso2", { nombre: "Web 4321", producto: "termix", total: 139 });
    expect(m.texto.startsWith("Hola,")).toBe(true);
    expect(m.plantilla.name).toBe("aliv_formulario_recordatorio");
    expect(m.plantilla.params[1]).toBe("2 Tobilleras Termix");
  });
});
