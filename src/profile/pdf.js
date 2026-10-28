/**
 * Reads text from a PDF on this machine. The file is not sent anywhere.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const standardFontDataUrl = new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href;

export async function pdfToText(buffer) {
  if (!buffer?.length || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("That file is not a PDF. Paste the CV text instead.");
  }
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl,
      useSystemFonts: false,
    }).promise;
  } catch {
    throw new Error("This PDF could not be read. Paste the CV text instead.");
  }
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  const text = pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No text could be read from that PDF. Paste the CV text instead.");
  return text;
}
