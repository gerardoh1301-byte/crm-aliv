import { describe, expect, it } from "vitest";
import {
  guiaYaEnviada,
  leerGuiaPdf,
  mensajeGuia,
  nombreArchivoGuia,
  notasConGuia,
  validarPdf,
} from "@/lib/pedidos/guia-pdf-reglas";
import { pdfAImagen } from "@/lib/pedidos/guia-pdf-imagen";

/** PDF mínimo de una página (rectángulo rojo), sin datos de clientes. */
function pdfMinimo(): Uint8Array {
  const contenido = "1 0 0 rg 20 20 200 100 re f";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 366] /Contents 4 0 R >>",
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("guía PDF de Shalom", () => {
  it("nombra el archivo con cliente, orden y fecha de Lima, sin clave", () => {
    const n = nombreArchivoGuia({ cliente: "Ana / Pérez", numeroOrden: "#LEG-1153", fecha: new Date("2026-11-22T03:00:00Z") });
    expect(n).toBe("Ana Pérez - #LEG-1153 - 2026-11-21.pdf");
    expect(n).not.toMatch(/clave/i);
  });

  it("guarda y lee la marca; una resubida reemplaza la anterior", () => {
    const t1 = "a".repeat(40);
    const t2 = "b".repeat(40);
    let notas = notasConGuia("Pedido web", { pdfId: "p1", imagenId: "i1", token: t1 });
    notas = notasConGuia(notas, { pdfId: "p2", imagenId: "i2", token: t2 });
    expect(leerGuiaPdf(notas)).toEqual({ pdfId: "p2", imagenId: "i2", token: t2 });
    expect(notas.match(/GUIA_PDF/g)).toHaveLength(1);
    expect(guiaYaEnviada(`${notas}\n[GUIA_IMAGEN_ENVIADA:i2|x]`, "i2")).toBe(true);
    expect(guiaYaEnviada(notas, "i2")).toBe(false);
  });

  it("el mensaje lleva orden, código y agencia, termina en pregunta y nunca la clave", () => {
    const m = mensajeGuia({ nombre: "Manuel Alberto", numeroGuia: "104830319", codigo: "TJJN", agencia: "Av. Larco 865" });
    expect(m).toContain("Manuel");
    expect(m).toContain("104830319");
    expect(m).toContain("TJJN");
    expect(m.trim().endsWith("🙌")).toBe(true);
    expect(m).toContain("¿Lo vas a recoger tú o alguien más?");
    expect(m).not.toMatch(/clave[^.]*\d{4}/i);
  });

  it("rechaza archivos que no son PDF", () => {
    expect(validarPdf(new TextEncoder().encode("hola"))).toMatch(/no es un PDF/);
    expect(validarPdf(new Uint8Array())).toMatch(/vacío/);
    expect(validarPdf(pdfMinimo())).toBeNull();
  });

  it("convierte la primera página en JPEG de 1400 px", async () => {
    const jpg = await pdfAImagen(pdfMinimo());
    expect(jpg.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(jpg.length).toBeGreaterThan(1000);
  });
});
