// Writes the Word reference documents the DOCX export styles its output with,
// one per bundled template (public/docx/<template>.docx), from Pandoc's
// default reference.docx. Run when the templates' typography changes; needs
// a local pandoc. The styles echo the Typst templates: a serif at 11 pt
// (article) or 12 pt with 1.5 spacing (thesis), justified text with indented
// paragraphs, black numbered headings, and chapters on a new page (thesis).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const out = resolve(import.meta.dirname, "..", "public", "docx");
const base = execFileSync("pandoc", ["--print-default-data-file", "reference.docx"]);

const layouts = {
  article: { size: 22, line: 264, h1: 26, h2: { size: 22, italic: true }, chapterBreak: false },
  thesis: { size: 24, line: 360, h1: 34, h2: { size: 26, italic: false }, chapterBreak: true },
};

mkdirSync(out, { recursive: true });
for (const [name, layout] of Object.entries(layouts)) {
  const files = unzip(base);
  const styles = files.get("word/styles.xml");
  if (!styles) throw new Error("reference.docx has no styles.xml");
  files.set("word/styles.xml", Buffer.from(restyle(styles.toString("utf8"), layout)));
  writeFileSync(resolve(out, `${name}.docx`), zip(files));
  console.log(`wrote public/docx/${name}.docx`);
}

function restyle(xml, l) {
  const font = '<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria" />';
  const size = (half) => `<w:sz w:val="${half}" /><w:szCs w:val="${half}" />`;
  const black = '<w:color w:val="000000" />';
  xml = xml.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, `<w:rPrDefault><w:rPr>${font}${size(l.size)}<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA" /></w:rPr></w:rPrDefault>`);
  xml = xml.replace(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/, `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${l.line}" w:lineRule="auto" /></w:pPr></w:pPrDefault>`);
  const set = (id, pPr, rPr) => {
    const re = new RegExp(`(<w:style [^>]*w:styleId="${id}"[^>]*>)([\\s\\S]*?)(</w:style>)`);
    if (!re.test(xml)) throw new Error(`No style ${id}`);
    xml = xml.replace(re, (_, open, inner, close) => {
      let body = inner.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "").replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "");
      if (pPr !== undefined) body += `<w:pPr>${pPr}</w:pPr>`;
      if (rPr !== undefined) body += `<w:rPr>${rPr}</w:rPr>`;
      return open + body + close;
    });
  };
  set("BodyText", `<w:spacing w:before="0" w:after="0" /><w:ind w:firstLine="340" /><w:jc w:val="both" />`);
  set("FirstParagraph", `<w:ind w:firstLine="0" />`);
  set("Compact", `<w:spacing w:before="0" w:after="60" /><w:ind w:firstLine="0" />`);
  set("Title", `<w:spacing w:before="0" w:after="160" /><w:jc w:val="center" />`, `${font}<w:b />${size(l.size + 12)}`);
  set("Subtitle", `<w:spacing w:before="0" w:after="200" /><w:jc w:val="center" />`, `${font}${size(l.size + 4)}`);
  set("Author", `<w:spacing w:before="0" w:after="40" /><w:jc w:val="center" />`, `${font}${size(l.size)}`);
  set("Date", `<w:spacing w:before="80" w:after="240" /><w:jc w:val="center" />`, `${font}${size(l.size - 2)}`);
  set("Abstract", `<w:spacing w:before="120" w:after="360" /><w:ind w:left="720" w:right="720" /><w:jc w:val="both" />`, size(l.size - 2));
  const heading = (id, before, after, rPr, extra = "") =>
    set(id, `<w:keepNext /><w:keepLines />${extra}<w:spacing w:before="${before}" w:after="${after}" /><w:jc w:val="left" /><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}" />`, `${font}${black}${rPr}`);
  heading("Heading1", l.chapterBreak ? 720 : 360, 180, `<w:b />${size(l.h1)}`, l.chapterBreak ? "<w:pageBreakBefore />" : "");
  heading("Heading2", 280, 120, `${l.h2.italic ? "<w:i />" : "<w:b />"}${size(l.h2.size)}`);
  heading("Heading3", 240, 100, `<w:b />${size(l.size)}`);
  heading("Heading4", 200, 80, `<w:i />${size(l.size)}`);
  set("Bibliography", `<w:spacing w:before="0" w:after="140" /><w:ind w:left="454" w:hanging="454" />`);
  set("FootnoteText", `<w:spacing w:before="0" w:after="60" w:line="240" w:lineRule="auto" /><w:jc w:val="both" />`, size(l.size - 4));
  set("BlockText", `<w:spacing w:before="160" w:after="160" /><w:ind w:left="480" w:right="480" /><w:jc w:val="both" />`, size(l.size - 1));
  set("Caption", `<w:spacing w:before="80" w:after="240" /><w:jc w:val="center" />`, size(l.size - 2));
  set("Hyperlink", undefined, '<w:color w:val="000000" />');
  return xml;
}

// Minimal ZIP reading and writing (stored or deflated entries, no ZIP64).
function unzip(buffer) {
  const files = new Map();
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let at = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataAt, dataAt + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0x00210000, 10); // 1980-01-01, so builds are reproducible
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0x00210000, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

function crc32(data) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
