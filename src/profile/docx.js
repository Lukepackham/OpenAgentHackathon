/**
 * Reads the main document from a DOCX file. DOCX is a zip archive.
 * Node's zlib can inflate it, so this does not add a package.
 */
import { inflateRawSync } from "node:zlib";

export function docxToText(buffer) {
  const xml = unzipEntry(buffer, "word/document.xml");
  if (!xml) throw new Error("This DOCX does not contain readable document text. Paste the text instead.");
  return decodeXml(xml)
    .replace(/<w:p\b[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unzipEntry(buffer, wanted) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.slice(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    if (flags & 0x08) {
      throw new Error("This DOCX stores its sizes in a trailer the demo cannot read. Paste the text instead.");
    }
    const data = buffer.slice(dataStart, dataStart + compressedSize);
    if (name === wanted) {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      throw new Error("This DOCX uses compression the demo cannot read. Paste the text instead.");
    }
    offset = dataStart + compressedSize;
  }
  return "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
