/** Primera página del PDF como JPEG de 1400 px de ancho (mupdf, sin binarios nativos). */
export async function pdfAImagen(pdf: Uint8Array): Promise<Buffer> {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    if (doc.countPages() < 1) throw new Error("El PDF no tiene páginas.");
    const page = doc.loadPage(0);
    const b = page.getBounds();
    const ancho = Math.max(1, b[2] - b[0]);
    const escala = Math.min(4, 1400 / ancho);
    const pix = page.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false, true);
    return Buffer.from(pix.asJPEG(88, false));
  } finally {
    doc.destroy?.();
  }
}
