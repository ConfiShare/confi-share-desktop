import JSZip from 'jszip';
import * as XLSX from 'xlsx';

type PreviewFormat =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'csv'
  | 'tsv'
  | 'txt'
  | 'rtf';

type TextAlign = 'left' | 'right' | 'center' | 'justify';

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fontSizePt?: number;
  fontFamily?: string;
  align?: TextAlign;
}

interface RichTextChunk {
  plain: string;
  html: string;
}

interface SpreadsheetCellStyle {
  textAlign?: TextAlign;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  font: InlineStyle;
  fillColor?: string;
}

interface SpreadsheetSheetMeta {
  name: string;
  path: string;
}

interface SpreadsheetRenderedCell {
  contentHtml: string;
  plainText: string;
  textStyle: InlineStyle;
  cellStyle?: SpreadsheetCellStyle;
}

interface SpreadsheetMergeRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

interface DocxNumberingRef {
  numId?: string;
  ilvl?: number;
}

interface DocxStyleMaps {
  paragraphAlign: Map<string, TextAlign>;
  paragraphRunStyle: Map<string, InlineStyle>;
  runStyle: Map<string, InlineStyle>;
  paragraphNumbering: Map<string, DocxNumberingRef>;
  defaultParagraphStyleId?: string;
  defaultParagraphAlign?: TextAlign;
}

interface DocxRawStyle {
  type: string;
  basedOn?: string;
  runStyle: InlineStyle;
  paragraphAlign?: TextAlign;
  numbering?: DocxNumberingRef;
}

interface DocxNumberingMaps {
  byNumLevel: Map<string, TextAlign>;
  byParagraphStyle: Map<string, TextAlign>;
}

interface OdfStyleEntry {
  align?: TextAlign;
  text?: InlineStyle;
}

interface OdfRawStyle {
  parentStyleName?: string;
  align?: TextAlign;
  text: InlineStyle;
}

export interface OfficePreviewData {
  kind: 'html';
  title: string;
  html: string;
}

const DIRECT_OFFICE_EXTENSIONS = new Set([
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.csv',
  '.tsv',
  '.txt',
  '.rtf',
]);

const DIRECT_OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/rtf',
  'text/rtf',
]);

const SHARED_STRINGS_CACHE_LIMIT = 20000;
const SHEET_PREVIEW_FONT_PT_MIN = 9.5;
const SHEET_PREVIEW_FONT_PT_MAX = 12.5;
const SHEET_PREVIEW_MIN_COL_CH = 8;
const SHEET_PREVIEW_MAX_COL_CH = 100;

const PREVIEW_STYLE_BLOCK = `
<style>
  .ofv-root {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    color: #0f172a;
    line-height: 1.5;
    font-size: 14px;
  }
  .ofv-root p {
    margin: 0 0 10px 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .ofv-root h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
  }
  .ofv-root .ofv-sheet {
    margin-top: 14px;
    border: 1px solid #000000;
    border-radius: 0;
    overflow: hidden;
    background: #ffffff;
  }
  .ofv-root .ofv-slide {
    margin-top: 14px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    background: #ffffff;
  }
  .ofv-root .ofv-sheet-header {
    background: #ffffff;
    border-bottom: 1px solid #000000;
    padding: 8px 10px;
  }
  .ofv-root .ofv-slide-header {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 9px 12px;
  }
  .ofv-root .ofv-sheet-body,
  .ofv-root .ofv-slide-body {
    padding: 12px;
  }
  .ofv-root .ofv-sheet-body {
    overflow-x: auto;
    overflow-y: auto;
    max-height: 72vh;
  }
  .ofv-root .ofv-sheet-body table {
    font-size: 12px;
    line-height: 1.35;
    table-layout: auto;
    width: max-content;
    min-width: 100%;
  }
  .ofv-root table {
    border-collapse: collapse;
  }
  .ofv-root td, .ofv-root th {
    border: 1px solid #000000;
    padding: 4px 5px;
    vertical-align: top;
    white-space: pre-wrap;
    word-break: break-word;
    min-width: 48px;
    width: auto;
    max-width: none;
  }
  .ofv-root th {
    background: #f1f5f9;
    font-weight: 700;
  }
  .ofv-root .ofv-empty {
    color: #64748b;
  }
  .ofv-root .ofv-separator {
    border-top: 1px dashed #cbd5e1;
    margin: 10px 0;
  }
</style>`;

function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  return fileName.slice(dot).toLowerCase();
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeDecodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const limit = Math.min(bytes.length, 4096);
  let printable = 0;
  let control = 0;
  for (let i = 0; i < limit; i += 1) {
    const v = bytes[i];
    if (v === 0) {
      control += 1;
      continue;
    }
    if ((v >= 9 && v <= 13) || (v >= 32 && v <= 126) || v >= 160) printable += 1;
    else control += 1;
  }
  return control / limit < 0.2 && printable / limit > 0.5;
}

function parseXml(xml: string): Document | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

function getAttributeByLocalName(element: Element, localName: string): string | null {
  for (const attr of Array.from(element.attributes)) {
    if (attr.localName === localName || attr.name === localName) return attr.value;
  }
  return null;
}

function getChildElementsByLocalName(element: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === localName) {
      result.push(child as Element);
    }
  }
  return result;
}

function getFirstChildByLocalName(element: Element, localName: string): Element | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === localName) {
      return child as Element;
    }
  }
  return null;
}

function getDescendantsByLocalName(root: Document | Element, localName: string): Element[] {
  const all = Array.from(root.getElementsByTagName('*'));
  return all.filter((node) => node.localName === localName);
}

function normalizeHexColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6,8}$/.test(clean)) return undefined;
  if (clean.length === 8) return `#${clean.slice(2).toUpperCase()}`;
  return `#${clean.toUpperCase()}`;
}

function sanitizeFontFamily(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.trim().replace(/[^a-zA-Z0-9 \-_,.]/g, '');
  if (!clean) return undefined;
  return clean.slice(0, 120);
}

function mapWordAlignment(value: string | null): TextAlign | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'left' || v === 'start') return 'left';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'center') return 'center';
  if (
    v === 'both' ||
    v === 'justify' ||
    v === 'distribute' ||
    v === 'thaidistribute' ||
    v === 'listtab' ||
    v === 'mediumkashida' ||
    v === 'highkashida' ||
    v === 'lowkashida'
  ) {
    return 'justify';
  }
  return undefined;
}

function mapSheetAlignment(value: string | null): TextAlign | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'left') return 'left';
  if (v === 'right') return 'right';
  if (v === 'center' || v === 'centercontinuous') return 'center';
  if (v === 'justify' || v === 'distributed') return 'justify';
  return undefined;
}

function mapSheetVerticalAlignment(value: string | null): 'top' | 'middle' | 'bottom' | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'top') return 'top';
  if (v === 'center') return 'middle';
  if (v === 'bottom') return 'bottom';
  return undefined;
}

function mapSlideAlignment(value: string | null): TextAlign | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'l' || v === 'left') return 'left';
  if (v === 'r' || v === 'right') return 'right';
  if (v === 'ctr' || v === 'center') return 'center';
  if (v === 'just' || v === 'dist' || v === 'thaidist') return 'justify';
  return undefined;
}

function styleToCss(style: InlineStyle): string {
  const css: string[] = [];
  const decorations: string[] = [];
  if (style.bold) css.push('font-weight:700');
  if (style.italic) css.push('font-style:italic');
  if (style.underline) decorations.push('underline');
  if (style.strike) decorations.push('line-through');
  if (decorations.length > 0) css.push(`text-decoration:${decorations.join(' ')}`);
  if (style.color) css.push(`color:${style.color}`);
  if (typeof style.fontSizePt === 'number' && Number.isFinite(style.fontSizePt) && style.fontSizePt > 0) {
    css.push(`font-size:${style.fontSizePt.toFixed(2).replace(/\.00$/, '')}pt`);
  }
  if (style.fontFamily) css.push(`font-family:'${style.fontFamily}',sans-serif`);
  if (style.align) css.push(`text-align:${style.align}`);
  return css.join(';');
}

function mergeStyles(base: InlineStyle, override: InlineStyle): InlineStyle {
  return {
    bold: override.bold ?? base.bold,
    italic: override.italic ?? base.italic,
    underline: override.underline ?? base.underline,
    strike: override.strike ?? base.strike,
    color: override.color ?? base.color,
    fontSizePt: override.fontSizePt ?? base.fontSizePt,
    fontFamily: override.fontFamily ?? base.fontFamily,
    align: override.align ?? base.align,
  };
}

function richTextFromPlain(value: string): RichTextChunk {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return {
    plain: normalized,
    html: escapeHtml(normalized).replace(/\t/g, '    '),
  };
}

function wrapRunText(text: string, style: InlineStyle): string {
  const chunk = richTextFromPlain(text);
  if (!chunk.plain) return '';
  const css = styleToCss(style);
  if (!css) return chunk.html;
  return `<span style="${css}">${chunk.html}</span>`;
}

function renderParagraph(contentHtml: string, align?: TextAlign): string {
  if (!contentHtml.trim()) return '<p>&nbsp;</p>';
  const style = align ? ` style="text-align:${align}"` : '';
  return `<p${style}>${contentHtml}</p>`;
}

function wrapPreview(title: string, bodyHtml: string): OfficePreviewData {
  return {
    kind: 'html',
    title,
    html: `${PREVIEW_STYLE_BLOCK}<div class="ofv-root">${bodyHtml || '<p class="ofv-empty">No previewable content found.</p>'}</div>`,
  };
}

function pathJoinZip(basePath: string, relative: string): string {
  const stack = basePath.split('/');
  stack.pop();
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

async function readZipTextIfExists(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return await entry.async('string');
}

function detectFormatFromMimeOrExt(fileName: string, mimeType: string): PreviewFormat | null {
  const ext = getFileExtension(fileName);
  const mime = normalizeMimeType(mimeType);
  if (ext === '.docx' || mime.includes('wordprocessingml.document')) return 'docx';
  if (ext === '.xlsx' || mime.includes('spreadsheetml.sheet')) return 'xlsx';
  if (ext === '.pptx' || mime.includes('presentationml.presentation')) return 'pptx';
  if (ext === '.odt' || mime === 'application/vnd.oasis.opendocument.text') return 'odt';
  if (ext === '.ods' || mime === 'application/vnd.oasis.opendocument.spreadsheet') return 'ods';
  if (ext === '.odp' || mime === 'application/vnd.oasis.opendocument.presentation') return 'odp';
  if (ext === '.csv' || mime === 'text/csv') return 'csv';
  if (ext === '.tsv' || mime === 'text/tab-separated-values') return 'tsv';
  if (ext === '.txt' || mime === 'text/plain') return 'txt';
  if (ext === '.rtf' || mime === 'application/rtf' || mime === 'text/rtf') return 'rtf';
  return null;
}

async function detectFormatByZipContents(fileBytes: Uint8Array): Promise<PreviewFormat | null> {
  if (!startsWithBytes(fileBytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  try {
    const zip = await JSZip.loadAsync(fileBytes);
    const names = Object.keys(zip.files);
    if (names.some((n) => n === 'word/document.xml' || n.startsWith('word/'))) return 'docx';
    if (names.some((n) => n === 'xl/workbook.xml' || n.startsWith('xl/'))) return 'xlsx';
    if (names.some((n) => n === 'ppt/presentation.xml' || n.startsWith('ppt/'))) return 'pptx';

    const mimetype = await readZipTextIfExists(zip, 'mimetype');
    if (mimetype) {
      const m = mimetype.trim().toLowerCase();
      if (m.includes('application/vnd.oasis.opendocument.text')) return 'odt';
      if (m.includes('application/vnd.oasis.opendocument.spreadsheet')) return 'ods';
      if (m.includes('application/vnd.oasis.opendocument.presentation')) return 'odp';
    }
  } catch {
    return null;
  }
  return null;
}

async function detectPreviewFormat(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<PreviewFormat | null> {
  const byDeclared = detectFormatFromMimeOrExt(fileName, mimeType);
  if (byDeclared) return byDeclared;

  const head = safeDecodeUtf8(fileBytes.slice(0, Math.min(128, fileBytes.length))).trimStart().toLowerCase();
  if (head.startsWith('{\\rtf')) return 'rtf';

  const byZip = await detectFormatByZipContents(fileBytes);
  if (byZip) return byZip;

  if (isProbablyText(fileBytes)) return 'txt';
  return null;
}

export function isDirectOfficePreviewType(fileName: string, mimeType: string): boolean {
  const ext = getFileExtension(fileName);
  if (DIRECT_OFFICE_EXTENSIONS.has(ext)) return true;
  return DIRECT_OFFICE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function detectImageMimeFromBytes(fileBytes: Uint8Array): string | null {
  if (startsWithBytes(fileBytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWithBytes(fileBytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(fileBytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWithBytes(fileBytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWithBytes(fileBytes, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(fileBytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff';
  }
  if (startsWithBytes(fileBytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  if (
    fileBytes.length >= 12 &&
    safeDecodeUtf8(fileBytes.slice(0, 4)) === 'RIFF' &&
    safeDecodeUtf8(fileBytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (fileBytes.length >= 12 && safeDecodeUtf8(fileBytes.slice(4, 8)) === 'ftyp') {
    const brand = safeDecodeUtf8(fileBytes.slice(8, 12)).toLowerCase();
    if (brand.includes('avif')) return 'image/avif';
    if (brand.includes('heic')) return 'image/heic';
    if (brand.includes('heif')) return 'image/heif';
  }
  return null;
}

export async function buildOfficePreview(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<OfficePreviewData | null> {
  const format = await detectPreviewFormat(fileBytes, fileName, mimeType);
  if (!format) return null;

  try {
    if (format === 'docx') return await buildDocxPreview(fileBytes, fileName);
    if (format === 'xlsx') return await buildXlsxPreview(fileBytes, fileName);
    if (format === 'pptx') return await buildPptxPreview(fileBytes, fileName);
    if (format === 'odt') return await buildOdtPreview(fileBytes, fileName);
    if (format === 'ods') return await buildOdsPreview(fileBytes, fileName);
    if (format === 'odp') return await buildOdpPreview(fileBytes, fileName);
    if (format === 'csv') return buildDelimitedPreview(fileBytes, fileName, ',');
    if (format === 'tsv') return buildDelimitedPreview(fileBytes, fileName, '\t');
    if (format === 'txt') return buildTextPreview(fileBytes, fileName);
    if (format === 'rtf') return buildRtfPreview(fileBytes, fileName);
  } catch (error) {
    console.warn('[officePreview] parser failed for', format, error);
    if (format === 'csv' || format === 'tsv' || format === 'txt') {
      return buildTextPreview(fileBytes, fileName);
    }
  }

  return null;
}

function parseDocxRunProperties(runProps: Element | null): InlineStyle {
  if (!runProps) return {};
  const style: InlineStyle = {};

  const bold = getFirstChildByLocalName(runProps, 'b');
  if (bold) {
    const v = getAttributeByLocalName(bold, 'val');
    style.bold = v ? !['false', '0', 'off'].includes(v.toLowerCase()) : true;
  }
  const italic = getFirstChildByLocalName(runProps, 'i');
  if (italic) {
    const v = getAttributeByLocalName(italic, 'val');
    style.italic = v ? !['false', '0', 'off'].includes(v.toLowerCase()) : true;
  }
  const underline = getFirstChildByLocalName(runProps, 'u');
  if (underline) {
    const v = getAttributeByLocalName(underline, 'val');
    style.underline = v ? !['none', '0', 'false', 'off'].includes(v.toLowerCase()) : true;
  }
  const strike = getFirstChildByLocalName(runProps, 'strike');
  if (strike) {
    const v = getAttributeByLocalName(strike, 'val');
    style.strike = v ? !['false', '0', 'off'].includes(v.toLowerCase()) : true;
  }
  const color = getFirstChildByLocalName(runProps, 'color');
  style.color = normalizeHexColor(getAttributeByLocalName(color ?? runProps, 'val'));

  const sizeNode = getFirstChildByLocalName(runProps, 'sz');
  const sizeRaw = getAttributeByLocalName(sizeNode ?? runProps, 'val');
  if (sizeRaw) {
    const parsed = Number(sizeRaw);
    if (Number.isFinite(parsed) && parsed > 0) style.fontSizePt = parsed / 2;
  }

  return style;
}

function parseDocxNumberingRef(container: Element | null): DocxNumberingRef | undefined {
  if (!container) return undefined;
  const numPr = getFirstChildByLocalName(container, 'numPr');
  if (!numPr) return undefined;

  const numId = getAttributeByLocalName(getFirstChildByLocalName(numPr, 'numId') ?? numPr, 'val') ?? undefined;
  const ilvlRaw = getAttributeByLocalName(getFirstChildByLocalName(numPr, 'ilvl') ?? numPr, 'val');
  const ilvlParsed = ilvlRaw ? Number(ilvlRaw) : undefined;
  const ilvl = typeof ilvlParsed === 'number' && Number.isFinite(ilvlParsed) ? ilvlParsed : undefined;
  if (!numId && typeof ilvl !== 'number') return undefined;
  return { numId, ilvl };
}

function parseDocxNumberingMaps(numberingXml: string | null): DocxNumberingMaps {
  const maps: DocxNumberingMaps = {
    byNumLevel: new Map(),
    byParagraphStyle: new Map(),
  };
  if (!numberingXml) return maps;

  const doc = parseXml(numberingXml);
  if (!doc) return maps;

  interface LvlInfo {
    align?: TextAlign;
    styleId?: string;
  }

  const abstractMap = new Map<string, Map<number, LvlInfo>>();
  for (const abstractNum of getDescendantsByLocalName(doc, 'abstractNum')) {
    const abstractId = getAttributeByLocalName(abstractNum, 'abstractNumId');
    if (!abstractId) continue;
    const levelMap = new Map<number, LvlInfo>();
    for (const lvl of getChildElementsByLocalName(abstractNum, 'lvl')) {
      const ilvlRaw = getAttributeByLocalName(lvl, 'ilvl');
      const ilvl = ilvlRaw ? Number(ilvlRaw) : 0;
      if (!Number.isFinite(ilvl)) continue;

      const pPr = getFirstChildByLocalName(lvl, 'pPr');
      const align =
        mapWordAlignment(getAttributeByLocalName(getFirstChildByLocalName(pPr ?? lvl, 'jc') ?? lvl, 'val')) ??
        mapWordAlignment(getAttributeByLocalName(getFirstChildByLocalName(lvl, 'lvlJc') ?? lvl, 'val'));
      const styleId = getAttributeByLocalName(getFirstChildByLocalName(lvl, 'pStyle') ?? lvl, 'val') ?? undefined;

      levelMap.set(ilvl, { align, styleId });
      if (align && styleId && !maps.byParagraphStyle.has(styleId)) {
        maps.byParagraphStyle.set(styleId, align);
      }
    }
    abstractMap.set(abstractId, levelMap);
  }

  for (const num of getDescendantsByLocalName(doc, 'num')) {
    const numId = getAttributeByLocalName(num, 'numId');
    const abstractId = getAttributeByLocalName(getFirstChildByLocalName(num, 'abstractNumId') ?? num, 'val');
    if (!numId || !abstractId) continue;

    const levels = abstractMap.get(abstractId);
    if (levels) {
      for (const [ilvl, info] of levels.entries()) {
        if (info.align) maps.byNumLevel.set(`${numId}:${ilvl}`, info.align);
      }
    }

    for (const override of getChildElementsByLocalName(num, 'lvlOverride')) {
      const ilvlRaw = getAttributeByLocalName(override, 'ilvl');
      const ilvl = ilvlRaw ? Number(ilvlRaw) : 0;
      if (!Number.isFinite(ilvl)) continue;

      const overrideLvl = getFirstChildByLocalName(override, 'lvl');
      const pPr = getFirstChildByLocalName(overrideLvl ?? override, 'pPr');
      const align =
        mapWordAlignment(getAttributeByLocalName(getFirstChildByLocalName(pPr ?? overrideLvl ?? override, 'jc') ?? override, 'val')) ??
        mapWordAlignment(getAttributeByLocalName(getFirstChildByLocalName(overrideLvl ?? override, 'lvlJc') ?? override, 'val'));
      if (align) maps.byNumLevel.set(`${numId}:${ilvl}`, align);
    }
  }

  return maps;
}

function parseDocxStyleMaps(stylesXml: string | null): DocxStyleMaps {
  const maps: DocxStyleMaps = {
    paragraphAlign: new Map(),
    paragraphRunStyle: new Map(),
    runStyle: new Map(),
    paragraphNumbering: new Map(),
  };
  if (!stylesXml) return maps;

  const doc = parseXml(stylesXml);
  if (!doc) return maps;

  const docDefaults = getDescendantsByLocalName(doc, 'docDefaults')[0];
  if (docDefaults) {
    const pPrDefault = getFirstChildByLocalName(docDefaults, 'pPrDefault');
    const pPr = getFirstChildByLocalName(pPrDefault ?? docDefaults, 'pPr');
    const jcHost = pPr ?? pPrDefault;
    if (jcHost) {
      maps.defaultParagraphAlign = mapWordAlignment(
        getAttributeByLocalName(getFirstChildByLocalName(jcHost, 'jc') ?? jcHost, 'val')
      );
    }
  }

  const rawStyles = new Map<string, DocxRawStyle>();
  for (const styleElement of getDescendantsByLocalName(doc, 'style')) {
    const styleId = getAttributeByLocalName(styleElement, 'styleId');
    const type = getAttributeByLocalName(styleElement, 'type');
    if (!styleId || !type) continue;

    const pPr = getFirstChildByLocalName(styleElement, 'pPr');
    const rPr = getFirstChildByLocalName(styleElement, 'rPr');
    const basedOn = getAttributeByLocalName(getFirstChildByLocalName(styleElement, 'basedOn') ?? styleElement, 'val') ?? undefined;
    const paragraphAlign = mapWordAlignment(
      getAttributeByLocalName(getFirstChildByLocalName(pPr ?? styleElement, 'jc') ?? styleElement, 'val')
    );
    const numbering = parseDocxNumberingRef(pPr);

    const isDefaultStyleAttr = getAttributeByLocalName(styleElement, 'default');
    const isDefaultStyle = isDefaultStyleAttr ? ['1', 'true', 'on'].includes(isDefaultStyleAttr.toLowerCase()) : false;
    if (type === 'paragraph' && isDefaultStyle) {
      maps.defaultParagraphStyleId = styleId;
    }

    rawStyles.set(styleId, {
      type,
      basedOn,
      runStyle: parseDocxRunProperties(rPr),
      paragraphAlign,
      numbering,
    });
  }

  const resolvedCache = new Map<string, { runStyle: InlineStyle; paragraphAlign?: TextAlign; numbering?: DocxNumberingRef }>();
  const resolving = new Set<string>();

  const resolveStyle = (styleId: string): { runStyle: InlineStyle; paragraphAlign?: TextAlign; numbering?: DocxNumberingRef } => {
    const cached = resolvedCache.get(styleId);
    if (cached) return cached;
    const raw = rawStyles.get(styleId);
    if (!raw) return { runStyle: {} };

    if (resolving.has(styleId)) {
      return { runStyle: raw.runStyle, paragraphAlign: raw.paragraphAlign, numbering: raw.numbering };
    }
    resolving.add(styleId);

    let inherited: { runStyle: InlineStyle; paragraphAlign?: TextAlign; numbering?: DocxNumberingRef } = { runStyle: {} };
    if (raw.basedOn) {
      const parentRaw = rawStyles.get(raw.basedOn);
      if (parentRaw && parentRaw.type === raw.type) inherited = resolveStyle(raw.basedOn);
    }

    const numbering: DocxNumberingRef | undefined =
      raw.numbering || inherited.numbering
        ? {
            numId: raw.numbering?.numId ?? inherited.numbering?.numId,
            ilvl: raw.numbering?.ilvl ?? inherited.numbering?.ilvl,
          }
        : undefined;

    const resolved = {
      runStyle: mergeStyles(inherited.runStyle, raw.runStyle),
      paragraphAlign: raw.paragraphAlign ?? inherited.paragraphAlign,
      numbering,
    };
    resolving.delete(styleId);
    resolvedCache.set(styleId, resolved);
    return resolved;
  };

  for (const [styleId, raw] of rawStyles.entries()) {
    const resolved = resolveStyle(styleId);
    if (raw.type === 'paragraph') {
      maps.paragraphRunStyle.set(styleId, resolved.runStyle);
      if (resolved.paragraphAlign) maps.paragraphAlign.set(styleId, resolved.paragraphAlign);
      if (resolved.numbering) maps.paragraphNumbering.set(styleId, resolved.numbering);
    } else if (raw.type === 'character') {
      maps.runStyle.set(styleId, resolved.runStyle);
    }
  }

  if (!maps.defaultParagraphStyleId && maps.paragraphRunStyle.has('Normal')) {
    maps.defaultParagraphStyleId = 'Normal';
  }

  return maps;
}

function extractDocxRunText(run: Element): string {
  let text = '';
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (element.localName === 't') text += element.textContent ?? '';
    else if (element.localName === 'tab') text += '\t';
    else if (element.localName === 'br' || element.localName === 'cr') text += '\n';
    else if (element.localName === 'drawing') text += '[Embedded Image]';
    else if (element.localName === 'instrText') text += element.textContent ?? '';
  }
  return text;
}

function renderDocxRuns(paragraph: Element, styleMaps: DocxStyleMaps, paragraphStyle: InlineStyle): string {
  let html = '';
  for (const child of Array.from(paragraph.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;

    if (element.localName === 'r') {
      const rPr = getFirstChildByLocalName(element, 'rPr');
      const rStyleEl = getFirstChildByLocalName(rPr ?? element, 'rStyle');
      const runStyleId = getAttributeByLocalName(rStyleEl ?? element, 'val');
      const characterStyle = runStyleId ? styleMaps.runStyle.get(runStyleId) ?? {} : {};
      const directStyle = parseDocxRunProperties(rPr);
      const mergedStyle = mergeStyles(mergeStyles(paragraphStyle, characterStyle), directStyle);
      html += wrapRunText(extractDocxRunText(element), mergedStyle);
      continue;
    }

    if (element.localName === 'hyperlink') {
      for (const linkRun of getChildElementsByLocalName(element, 'r')) {
        const rPr = getFirstChildByLocalName(linkRun, 'rPr');
        const rStyleEl = getFirstChildByLocalName(rPr ?? linkRun, 'rStyle');
        const runStyleId = getAttributeByLocalName(rStyleEl ?? linkRun, 'val');
        const characterStyle = runStyleId ? styleMaps.runStyle.get(runStyleId) ?? {} : {};
        const directStyle = parseDocxRunProperties(rPr);
        const mergedStyle = mergeStyles(mergeStyles(paragraphStyle, characterStyle), directStyle);
        html += wrapRunText(extractDocxRunText(linkRun), mergedStyle);
      }
    }
  }
  return html;
}

function resolveDocxParagraphAlignment(
  paragraph: Element,
  styleMaps: DocxStyleMaps,
  numberingMaps: DocxNumberingMaps,
): TextAlign | undefined {
  const pPr = getFirstChildByLocalName(paragraph, 'pPr');
  const styleRef = getAttributeByLocalName(getFirstChildByLocalName(pPr ?? paragraph, 'pStyle') ?? paragraph, 'val');

  const directAlign = mapWordAlignment(
    getAttributeByLocalName(getFirstChildByLocalName(pPr ?? paragraph, 'jc') ?? paragraph, 'val')
  );
  if (directAlign) return directAlign;

  const effectiveStyleRef = styleRef && styleMaps.paragraphRunStyle.has(styleRef)
    ? styleRef
    : styleMaps.defaultParagraphStyleId ?? 'Normal';

  const styleAlign = styleMaps.paragraphAlign.get(effectiveStyleRef);
  if (styleAlign) return styleAlign;

  const directNumRef = parseDocxNumberingRef(pPr);
  const styleNumRef = styleRef ? styleMaps.paragraphNumbering.get(styleRef) : undefined;
  const defaultNumRef = styleMaps.paragraphNumbering.get(styleMaps.defaultParagraphStyleId ?? 'Normal');
  const numRef = directNumRef ?? styleNumRef ?? defaultNumRef;
  if (numRef?.numId) {
    const level = numRef.ilvl ?? 0;
    const align = numberingMaps.byNumLevel.get(`${numRef.numId}:${level}`);
    if (align) return align;
  }

  if (styleRef) {
    const byStyle = numberingMaps.byParagraphStyle.get(styleRef);
    if (byStyle) return byStyle;
  }

  return styleMaps.defaultParagraphAlign;
}

function renderDocxParagraph(
  paragraph: Element,
  styleMaps: DocxStyleMaps,
  numberingMaps: DocxNumberingMaps,
): string {
  const pPr = getFirstChildByLocalName(paragraph, 'pPr');
  const styleRef = getAttributeByLocalName(getFirstChildByLocalName(pPr ?? paragraph, 'pStyle') ?? paragraph, 'val');
  const effectiveStyleRef = styleRef && styleMaps.paragraphRunStyle.has(styleRef)
    ? styleRef
    : styleMaps.defaultParagraphStyleId ?? 'Normal';
  const paragraphStyle = styleMaps.paragraphRunStyle.get(effectiveStyleRef) ?? {};
  const align = resolveDocxParagraphAlignment(paragraph, styleMaps, numberingMaps) ?? 'left';
  const contentHtml = renderDocxRuns(paragraph, styleMaps, paragraphStyle);
  return renderParagraph(contentHtml, align);
}

function renderDocxTable(table: Element, styleMaps: DocxStyleMaps, numberingMaps: DocxNumberingMaps): string {
  const rowHtml: string[] = [];
  for (const row of getChildElementsByLocalName(table, 'tr')) {
    const cellHtml = getChildElementsByLocalName(row, 'tc').map((cell) => {
      const paragraphs = getChildElementsByLocalName(cell, 'p');
      const rendered = paragraphs.map((p) => renderDocxParagraph(p, styleMaps, numberingMaps)).join('');
      return `<td>${rendered || '&nbsp;'}</td>`;
    });
    rowHtml.push(`<tr>${cellHtml.join('')}</tr>`);
  }
  return `<table><tbody>${rowHtml.join('')}</tbody></table>`;
}

async function buildDocxPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const documentXml = await readZipTextIfExists(zip, 'word/document.xml');
  if (!documentXml) return null;
  const stylesXml = await readZipTextIfExists(zip, 'word/styles.xml');
  const numberingXml = await readZipTextIfExists(zip, 'word/numbering.xml');

  const doc = parseXml(documentXml);
  if (!doc) return null;

  const styleMaps = parseDocxStyleMaps(stylesXml);
  const numberingMaps = parseDocxNumberingMaps(numberingXml);
  const body = getDescendantsByLocalName(doc, 'body')[0];
  if (!body) return null;

  const parts: string[] = [];
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    if (element.localName === 'p') {
      parts.push(renderDocxParagraph(element, styleMaps, numberingMaps));
    } else if (element.localName === 'tbl') {
      parts.push(renderDocxTable(element, styleMaps, numberingMaps));
    }
  }

  return wrapPreview(fileName, parts.join('') || '<p class="ofv-empty">No readable text found in this document.</p>');
}

function columnLabelToIndex(label: string): number {
  let result = 0;
  for (const ch of label.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) continue;
    result = result * 26 + (code - 64);
  }
  return Math.max(0, result - 1);
}

function parseCellReference(reference: string): { col: number; row: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(reference);
  if (!match) return null;
  return {
    col: columnLabelToIndex(match[1]),
    row: Number(match[2]) - 1,
  };
}

function parseSpreadsheetFont(fontElement: Element | null): InlineStyle {
  if (!fontElement) return {};
  const style: InlineStyle = {};
  if (getFirstChildByLocalName(fontElement, 'b')) style.bold = true;
  if (getFirstChildByLocalName(fontElement, 'i')) style.italic = true;
  if (getFirstChildByLocalName(fontElement, 'u')) style.underline = true;
  if (getFirstChildByLocalName(fontElement, 'strike')) style.strike = true;
  const color = getFirstChildByLocalName(fontElement, 'color');
  style.color = normalizeHexColor(getAttributeByLocalName(color ?? fontElement, 'rgb'));
  const sizeRaw = getAttributeByLocalName(getFirstChildByLocalName(fontElement, 'sz') ?? fontElement, 'val');
  if (sizeRaw) {
    const size = Number(sizeRaw);
    if (Number.isFinite(size)) style.fontSizePt = size;
  }
  const name = getAttributeByLocalName(getFirstChildByLocalName(fontElement, 'name') ?? fontElement, 'val');
  style.fontFamily = sanitizeFontFamily(name);
  return style;
}

function parseSpreadsheetStyles(stylesXml: string | null): SpreadsheetCellStyle[] {
  if (!stylesXml) return [];
  const doc = parseXml(stylesXml);
  if (!doc) return [];

  interface XfInfo {
    fontId?: number;
    textAlign?: TextAlign;
    verticalAlign?: 'top' | 'middle' | 'bottom';
    fillColor?: string;
  }

  function parseXf(xf: Element): XfInfo {
    const fontIdRaw = getAttributeByLocalName(xf, 'fontId');
    const fillIdRaw = getAttributeByLocalName(xf, 'fillId');
    const fontId = fontIdRaw ? Number(fontIdRaw) : undefined;
    const fillId = fillIdRaw ? Number(fillIdRaw) : undefined;
    const alignmentEl = getFirstChildByLocalName(xf, 'alignment');
    return {
      fontId: typeof fontId === 'number' && Number.isFinite(fontId) ? fontId : undefined,
      textAlign: mapSheetAlignment(getAttributeByLocalName(alignmentEl ?? xf, 'horizontal')),
      verticalAlign: mapSheetVerticalAlignment(getAttributeByLocalName(alignmentEl ?? xf, 'vertical')),
      fillColor:
        typeof fillId === 'number' && Number.isFinite(fillId) && fills[fillId]
          ? fills[fillId]
          : undefined,
    };
  }

  const styleXfs: XfInfo[] = [];
  const styleXfsRoot = getDescendantsByLocalName(doc, 'cellStyleXfs')[0];
  if (styleXfsRoot) {
    for (const xf of getChildElementsByLocalName(styleXfsRoot, 'xf')) {
      styleXfs.push(parseXf(xf));
    }
  }

  const fills: (string | undefined)[] = [];
  const fillsRoot = getDescendantsByLocalName(doc, 'fills')[0];
  if (fillsRoot) {
    for (const fillEl of getChildElementsByLocalName(fillsRoot, 'fill')) {
      const patternFill = getFirstChildByLocalName(fillEl, 'patternFill');
      const fgColor = getFirstChildByLocalName(patternFill ?? fillEl, 'fgColor');
      fills.push(normalizeHexColor(getAttributeByLocalName(fgColor ?? fillEl, 'rgb')));
    }
  }

  const fonts: InlineStyle[] = [];
  const fontsRoot = getDescendantsByLocalName(doc, 'fonts')[0];
  if (fontsRoot) {
    for (const fontEl of getChildElementsByLocalName(fontsRoot, 'font')) {
      fonts.push(parseSpreadsheetFont(fontEl));
    }
  }

  const result: SpreadsheetCellStyle[] = [];
  const cellXfsRoot = getDescendantsByLocalName(doc, 'cellXfs')[0];
  if (!cellXfsRoot) return result;

  for (const xf of getChildElementsByLocalName(cellXfsRoot, 'xf')) {
    const xfInfo = parseXf(xf);
    const xfIdRaw = getAttributeByLocalName(xf, 'xfId');
    const xfId = xfIdRaw ? Number(xfIdRaw) : undefined;
    const styleBase =
      typeof xfId === 'number' && Number.isFinite(xfId) && styleXfs[xfId]
        ? styleXfs[xfId]
        : undefined;

    const fontId = xfInfo.fontId ?? styleBase?.fontId ?? 0;
    result.push({
      textAlign: xfInfo.textAlign ?? styleBase?.textAlign,
      verticalAlign: xfInfo.verticalAlign ?? styleBase?.verticalAlign,
      font: fonts[fontId] ?? {},
    });
  }

  return result;
}

function parseSpreadsheetRichString(container: Element): RichTextChunk {
  const runs = getChildElementsByLocalName(container, 'r');
  if (runs.length === 0) {
    const plain = getDescendantsByLocalName(container, 't').map((t) => t.textContent ?? '').join('');
    return richTextFromPlain(plain);
  }

  let plain = '';
  const htmlParts: string[] = [];
  for (const run of runs) {
    const rPr = getFirstChildByLocalName(run, 'rPr');
    const t = getFirstChildByLocalName(run, 't');
    const text = t?.textContent ?? '';
    plain += text;

    const style: InlineStyle = {};
    if (rPr) {
      if (getFirstChildByLocalName(rPr, 'b')) style.bold = true;
      if (getFirstChildByLocalName(rPr, 'i')) style.italic = true;
      if (getFirstChildByLocalName(rPr, 'u')) style.underline = true;
      if (getFirstChildByLocalName(rPr, 'strike')) style.strike = true;
      const color = getFirstChildByLocalName(rPr, 'color');
      style.color = normalizeHexColor(getAttributeByLocalName(color ?? rPr, 'rgb'));

      const sizeRaw = getAttributeByLocalName(getFirstChildByLocalName(rPr, 'sz') ?? rPr, 'val');
      if (sizeRaw) {
        const size = Number(sizeRaw);
        if (Number.isFinite(size)) style.fontSizePt = size;
      }

      const fontName = getAttributeByLocalName(getFirstChildByLocalName(rPr, 'rFont') ?? rPr, 'val');
      if (fontName) style.fontFamily = sanitizeFontFamily(fontName);
    }

    htmlParts.push(wrapRunText(text, style));
  }
  return { plain, html: htmlParts.join('') };
}

function parseSharedStrings(sharedStringsXml: string | null): RichTextChunk[] {
  if (!sharedStringsXml) return [];
  const doc = parseXml(sharedStringsXml);
  if (!doc) return [];

  const items: RichTextChunk[] = [];
  for (const si of getDescendantsByLocalName(doc, 'si')) {
    items.push(parseSpreadsheetRichString(si));
    if (items.length > SHARED_STRINGS_CACHE_LIMIT) break;
  }
  return items;
}

function parseWorkbookSheetMeta(workbookXml: string | null, workbookRelsXml: string | null): SpreadsheetSheetMeta[] {
  if (!workbookXml) return [];
  const workbookDoc = parseXml(workbookXml);
  if (!workbookDoc) return [];

  const relMap = new Map<string, string>();
  if (workbookRelsXml) {
    const relDoc = parseXml(workbookRelsXml);
    if (relDoc) {
      for (const rel of getDescendantsByLocalName(relDoc, 'Relationship')) {
        const id = getAttributeByLocalName(rel, 'Id');
        const target = getAttributeByLocalName(rel, 'Target');
        if (id && target) relMap.set(id, pathJoinZip('xl/workbook.xml', target));
      }
    }
  }

  const result: SpreadsheetSheetMeta[] = [];
  for (const sheet of getDescendantsByLocalName(workbookDoc, 'sheet')) {
    const name = getAttributeByLocalName(sheet, 'name') ?? 'Sheet';
    const relId = getAttributeByLocalName(sheet, 'id') ?? getAttributeByLocalName(sheet, 'r:id');
    const path = relId ? relMap.get(relId) : undefined;
    if (path) result.push({ name, path });
  }
  return result;
}

function parseSheetColumnWidths(sheetDoc: Document): Map<number, number> {
  const result = new Map<number, number>();
  const colsRoot = getDescendantsByLocalName(sheetDoc, 'cols')[0];
  if (!colsRoot) return result;

  for (const colEl of getChildElementsByLocalName(colsRoot, 'col')) {
    const minRaw = Number(getAttributeByLocalName(colEl, 'min'));
    const maxRaw = Number(getAttributeByLocalName(colEl, 'max'));
    const widthRaw = Number(getAttributeByLocalName(colEl, 'width'));
    if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw) || !Number.isFinite(widthRaw)) continue;
    const start = Math.max(0, Math.floor(minRaw) - 1);
    const end = Math.max(start, Math.floor(maxRaw) - 1);
    const width = Math.max(SHEET_PREVIEW_MIN_COL_CH, Math.min(SHEET_PREVIEW_MAX_COL_CH, widthRaw));
    for (let col = start; col <= end; col += 1) result.set(col, width);
  }

  return result;
}

function parseSheetMergeRanges(sheetDoc: Document): SpreadsheetMergeRange[] {
  const mergeCells = getDescendantsByLocalName(sheetDoc, 'mergeCells')[0];
  if (!mergeCells) return [];
  const ranges: SpreadsheetMergeRange[] = [];
  for (const mergeCell of getChildElementsByLocalName(mergeCells, 'mergeCell')) {
    const ref = getAttributeByLocalName(mergeCell, 'ref');
    if (!ref) continue;
    const [startRefRaw, endRefRaw] = ref.split(':');
    const start = parseCellReference(startRefRaw);
    const end = parseCellReference(endRefRaw ?? startRefRaw);
    if (!start || !end) continue;
    ranges.push({
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endCol: Math.max(start.col, end.col),
    });
  }
  return ranges;
}

function spreadsheetCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function normalizeSheetFontForPreview(style: InlineStyle): InlineStyle {
  const normalized: InlineStyle = { ...style };
  if (typeof style.fontSizePt === 'number' && Number.isFinite(style.fontSizePt)) {
    const clamped = Math.max(SHEET_PREVIEW_FONT_PT_MIN, Math.min(SHEET_PREVIEW_FONT_PT_MAX, style.fontSizePt));
    normalized.fontSizePt = Number(clamped.toFixed(2));
  }
  return normalized;
}

function estimateTextColumnWidth(text: string): number {
  const compact = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!compact) return SHEET_PREVIEW_MIN_COL_CH;
  const longest = compact.split('\n').reduce((max, line) => Math.max(max, line.trim().length), 0);
  const weighted = Math.round(longest * 1.05 + 4);
  return Math.max(SHEET_PREVIEW_MIN_COL_CH, Math.min(SHEET_PREVIEW_MAX_COL_CH, weighted));
}

function buildSpreadsheetCellCss(
  style: SpreadsheetCellStyle | undefined,
  options?: { forceCenter?: boolean; forceMiddle?: boolean },
): string {
  const css: string[] = [];
  const textAlign = options?.forceCenter ? 'center' : style?.textAlign;
  const verticalAlign = options?.forceMiddle ? 'middle' : style?.verticalAlign;
  if (style?.fillColor) css.push(`background-color:${style.fillColor}`);
  if (textAlign) css.push(`text-align:${textAlign}`);
  if (verticalAlign) css.push(`vertical-align:${verticalAlign}`);
  return css.join(';');
}

function parseInlineStringCell(cell: Element): RichTextChunk {
  const isNode = getFirstChildByLocalName(cell, 'is');
  if (!isNode) return richTextFromPlain('');
  return parseSpreadsheetRichString(isNode);
}

function getCellValueChunk(cell: Element, sharedStrings: RichTextChunk[]): RichTextChunk {
  const cellType = getAttributeByLocalName(cell, 't');
  if (cellType === 'inlineStr') return parseInlineStringCell(cell);

  const valueNode = getFirstChildByLocalName(cell, 'v');
  const raw = valueNode?.textContent ?? '';

  if (cellType === 's') {
    const index = Number(raw);
    if (Number.isFinite(index) && sharedStrings[index]) return sharedStrings[index];
    return richTextFromPlain(raw);
  }
  if (cellType === 'b') return richTextFromPlain(raw === '1' ? 'TRUE' : 'FALSE');
  return richTextFromPlain(raw);
}

async function buildXlsxPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  // Try parsing with SheetJS first to support both .xlsx and legacy .xls without LibreOffice
  try {
    const arrayBuffer = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) as ArrayBuffer;
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });
    const sheetNames = workbook.SheetNames || [];
    const normalizeRgb = (rgb?: string): string | undefined => {
      if (!rgb) return undefined;
      const clean = rgb.replace(/[^0-9A-Fa-f]/g, '');
      if (clean.length === 8) return `#${clean.slice(2)}`;
      if (clean.length === 6) return `#${clean}`;
      return undefined;
    };

    if (sheetNames.length > 0) {
      const renderedSheets: string[] = [];
      for (let si = 0; si < Math.min(sheetNames.length, 12); si += 1) {
        const name = sheetNames[si] ?? `Sheet ${si + 1}`;
        const sheet = workbook.Sheets[sheetNames[si]];
        if (!sheet) continue;
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
        if (!rows || rows.length === 0) continue;

        const merges = sheet['!merges'] ?? [];
        const mergeStart = new Map<string, { colspan: number; rowspan: number }>();
        const mergedCells = new Set<string>();
        for (const merge of merges) {
          const startRow = merge.s.r;
          const startCol = merge.s.c;
          const endRow = merge.e.r;
          const endCol = merge.e.c;
          mergeStart.set(`${startRow}:${startCol}`, {
            colspan: endCol - startCol + 1,
            rowspan: endRow - startRow + 1,
          });
          for (let rr = startRow; rr <= endRow; rr += 1) {
            for (let cc = startCol; cc <= endCol; cc += 1) {
              if (rr === startRow && cc === startCol) continue;
              mergedCells.add(`${rr}:${cc}`);
            }
          }
        }

        let maxCols = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
        for (const merge of merges) {
          maxCols = Math.max(maxCols, merge.e.c + 1);
        }
        maxCols = Math.min(maxCols, 120);
        const maxRows = Math.min(rows.length, 500);

        const colsMeta = sheet['!cols'] ?? [];
        const columnWidths = Array.from({ length: maxCols }).map((_, colIndex) => {
          const meta = colsMeta[colIndex];
          if (meta && typeof meta.wch === 'number') {
            return Math.min(50, Math.max(8, Math.round(meta.wch * 1.1)));
          }
          let maxLength = 8;
          for (let r = 0; r < Math.min(rows.length, 200); r += 1) {
            const row = rows[r] ?? [];
            const value = row[colIndex];
            if (value !== undefined && value !== null) {
              maxLength = Math.max(maxLength, String(value).length + 2);
            }
          }
          return Math.min(60, Math.max(8, Math.round(maxLength * 1.05)));
        });

        const colgroup = `<colgroup>${columnWidths.map((width) => `<col style="width:${width}ch;min-width:${width}ch" />`).join('')}</colgroup>`;
        const rowsHtml: string[] = [];
        for (let r = 0; r < maxRows; r += 1) {
          const row = rows[r] ?? [];
          const cells = [];
          for (let c = 0; c < maxCols; c += 1) {
            const key = `${r}:${c}`;
            if (mergedCells.has(key)) continue;

            const mergeInfo = mergeStart.get(key);
            const value = row[c];
            const tag = r === 0 ? 'th' : 'td';
            const text = value === undefined || value === null ? '' : String(value);
            const cellHtml = text.trim() === '' ? '&nbsp;' : escapeHtml(text);
            const attrs: string[] = [];
            const styleEntries: string[] = [];

            if (mergeInfo) {
              if (mergeInfo.colspan > 1) attrs.push(`colspan="${mergeInfo.colspan}"`);
              if (mergeInfo.rowspan > 1) attrs.push(`rowspan="${mergeInfo.rowspan}"`);
            }

            const cellObject = sheet[XLSX.utils.encode_cell({ r, c })] as {
              s?: {
                font?: { bold?: boolean; italic?: boolean; underline?: boolean | string; color?: { rgb?: string } ; name?: string; sz?: number };
                alignment?: { horizontal?: string; vertical?: string };
                fill?: { fgColor?: { rgb?: string } };
              };
            } | undefined;
            const font = cellObject?.s?.font;
            const alignment = cellObject?.s?.alignment;
            const fill = cellObject?.s?.fill;
            if (font) {
              if (font.bold) styleEntries.push('font-weight:700');
              if (font.italic) styleEntries.push('font-style:italic');
              if (font.underline) styleEntries.push('text-decoration:underline');
              if (font.name) styleEntries.push(`font-family:'${font.name.replace(/[^a-zA-Z0-9 \-_,.]/g, '')}',sans-serif`);
              if (typeof font.sz === 'number' && Number.isFinite(font.sz)) styleEntries.push(`font-size:${font.sz}px`);
              const color = normalizeRgb(font.color?.rgb);
              if (color) styleEntries.push(`color:${color}`);
            }
            if (fill?.fgColor?.rgb) {
              const bg = normalizeRgb(fill.fgColor.rgb);
              if (bg) styleEntries.push(`background-color:${bg}`);
            }
            if (alignment?.horizontal) {
              styleEntries.push(`text-align:${alignment.horizontal}`);
            }
            if (alignment?.vertical) {
              const vertical = alignment.vertical.toLowerCase();
              if (vertical === 'center') styleEntries.push('vertical-align:middle');
              else if (vertical === 'bottom') styleEntries.push('vertical-align:bottom');
              else if (vertical === 'top') styleEntries.push('vertical-align:top');
            }
            if (styleEntries.length > 0) {
              attrs.push(`style="${styleEntries.join(';')}"`);
            }

            cells.push(`<${tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${cellHtml}</${tag}>`);
          }
          rowsHtml.push(`<tr>${cells.join('')}</tr>`);
        }

        renderedSheets.push(`<section class="ofv-sheet"><div class="ofv-sheet-header"><h3>${escapeHtml(name)}</h3></div><div class="ofv-sheet-body"><table>${colgroup}<tbody>${rowsHtml.join('')}</tbody></table></div></section>`);
      }
      if (renderedSheets.length > 0) return wrapPreview(fileName, renderedSheets.join(''));
    }
  } catch (e) {
    // Fall back to existing ZIP-based parser below
    console.warn('[officePreview] SheetJS parse failed, falling back to ZIP parser:', e);
  }
  const zip = await JSZip.loadAsync(fileBytes);
  const workbookXml = await readZipTextIfExists(zip, 'xl/workbook.xml');
  const workbookRelsXml = await readZipTextIfExists(zip, 'xl/_rels/workbook.xml.rels');
  const stylesXml = await readZipTextIfExists(zip, 'xl/styles.xml');
  const sharedStringsXml = await readZipTextIfExists(zip, 'xl/sharedStrings.xml');

  const sheetMeta = parseWorkbookSheetMeta(workbookXml, workbookRelsXml);
  const fallbackMeta = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((a, b) => {
      const aNum = Number(a.match(/sheet(\d+)\.xml/i)?.[1] ?? '0');
      const bNum = Number(b.match(/sheet(\d+)\.xml/i)?.[1] ?? '0');
      return aNum - bNum;
    })
    .map((path, index) => ({ name: `Sheet ${index + 1}`, path }));
  const sheets = sheetMeta.length > 0 ? sheetMeta : fallbackMeta;
  if (sheets.length === 0) return null;

  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const styles = parseSpreadsheetStyles(stylesXml);
  const renderedSheets: string[] = [];

  for (const sheet of sheets.slice(0, 12)) {
    const sheetXml = await readZipTextIfExists(zip, sheet.path);
    if (!sheetXml) continue;
    const sheetDoc = parseXml(sheetXml);
    if (!sheetDoc) continue;
    const sheetData = getDescendantsByLocalName(sheetDoc, 'sheetData')[0];
    if (!sheetData) continue;

    const declaredColumnWidths = parseSheetColumnWidths(sheetDoc);
    const estimatedColumnWidths = new Map<number, number>();
    const rowMap = new Map<number, Map<number, SpreadsheetRenderedCell>>();
    let minRow = Number.MAX_SAFE_INTEGER;
    let maxRow = -1;
    let maxCol = 0;

    for (const rowEl of getChildElementsByLocalName(sheetData, 'row')) {
      const rowRaw = getAttributeByLocalName(rowEl, 'r');
      const rowFromAttr = rowRaw ? Math.max(0, Number(rowRaw) - 1) : undefined;
      const rowIndex = typeof rowFromAttr === 'number' && Number.isFinite(rowFromAttr) ? rowFromAttr : rowMap.size;

      minRow = Math.min(minRow, rowIndex);
      maxRow = Math.max(maxRow, rowIndex);
      if (!rowMap.has(rowIndex)) rowMap.set(rowIndex, new Map());
      const row = rowMap.get(rowIndex)!;

      for (const cell of getChildElementsByLocalName(rowEl, 'c')) {
        const ref = getAttributeByLocalName(cell, 'r');
        const parsedRef = ref ? parseCellReference(ref) : null;
        const colIndex = parsedRef ? parsedRef.col : row.size;
        const valueChunk = getCellValueChunk(cell, sharedStrings);
        const cellType = getAttributeByLocalName(cell, 't');

        const styleIndexRaw = Number(getAttributeByLocalName(cell, 's') ?? '0');
        let style = Number.isFinite(styleIndexRaw) && styles[styleIndexRaw] ? { ...styles[styleIndexRaw] } : undefined;
        if (!style?.textAlign && cellType === 'n') {
          style = { ...(style ?? {}), textAlign: 'right', font: style?.font ?? {} };
        }
        const normalizedFont = normalizeSheetFontForPreview(style?.font ?? {});
        const valueCss = style ? styleToCss(normalizedFont) : '';

        row.set(colIndex, {
          contentHtml: valueCss ? `<span style="${valueCss}">${valueChunk.html || '&nbsp;'}</span>` : (valueChunk.html || '&nbsp;'),
          plainText: valueChunk.plain,
          textStyle: normalizedFont,
          cellStyle: style,
        });

        const widthGuess = estimateTextColumnWidth(valueChunk.plain);
        const currentWidth = estimatedColumnWidths.get(colIndex) ?? SHEET_PREVIEW_MIN_COL_CH;
        estimatedColumnWidths.set(colIndex, Math.max(currentWidth, widthGuess));
        if (colIndex > maxCol) maxCol = colIndex;
      }
    }

    const mergeRanges = parseSheetMergeRanges(sheetDoc);
    const mergeOrigins = new Map<string, { rowspan: number; colspan: number }>();
    const coveredByMerge = new Set<string>();

    for (const merge of mergeRanges) {
      const rowspan = merge.endRow - merge.startRow + 1;
      const colspan = merge.endCol - merge.startCol + 1;
      if (rowspan <= 0 || colspan <= 0) continue;

      mergeOrigins.set(spreadsheetCellKey(merge.startRow, merge.startCol), { rowspan, colspan });
      minRow = Math.min(minRow, merge.startRow);
      maxRow = Math.max(maxRow, merge.endRow);
      maxCol = Math.max(maxCol, merge.endCol);

      for (let r = merge.startRow; r <= merge.endRow; r += 1) {
        if (!rowMap.has(r)) rowMap.set(r, new Map());
        for (let c = merge.startCol; c <= merge.endCol; c += 1) {
          if (r === merge.startRow && c === merge.startCol) continue;
          coveredByMerge.add(spreadsheetCellKey(r, c));
        }
      }

      const originRow = rowMap.get(merge.startRow)!;
      if (!originRow.has(merge.startCol)) {
        originRow.set(merge.startCol, {
          contentHtml: '&nbsp;',
          plainText: '',
          textStyle: {},
          cellStyle: undefined,
        });
      }

      const originCell = originRow.get(merge.startCol);
      if (originCell && colspan > 1 && originCell.plainText.trim()) {
        const distributed = Math.max(
          SHEET_PREVIEW_MIN_COL_CH,
          Math.floor(estimateTextColumnWidth(originCell.plainText) / colspan),
        );
        for (let c = merge.startCol; c <= merge.endCol; c += 1) {
          const current = estimatedColumnWidths.get(c) ?? SHEET_PREVIEW_MIN_COL_CH;
          estimatedColumnWidths.set(c, Math.max(current, distributed));
        }
      }
    }

    if (maxRow < 0) continue;
    if (minRow === Number.MAX_SAFE_INTEGER) minRow = 0;

    const maxRenderableRow = Math.min(maxRow, minRow + 499);
    const maxRenderableCol = Math.min(maxCol, 120);
    const colgroup = maxRenderableCol >= 0
      ? `<colgroup>${Array.from({ length: maxRenderableCol + 1 })
          .map((_, col) => {
            const declared = declaredColumnWidths.get(col);
            const estimated = estimatedColumnWidths.get(col);
            const widthCh = Math.max(declared ?? 0, estimated ?? SHEET_PREVIEW_MIN_COL_CH);
            const clamped = Math.max(SHEET_PREVIEW_MIN_COL_CH, Math.min(SHEET_PREVIEW_MAX_COL_CH, widthCh));
            return `<col style="width:${clamped}ch;min-width:${clamped}ch" />`;
          })
          .join('')}</colgroup>`
      : '';

    const rowsHtml: string[] = [];
    for (let rowIndex = minRow; rowIndex <= maxRenderableRow; rowIndex += 1) {
      const row = rowMap.get(rowIndex) ?? new Map<number, SpreadsheetRenderedCell>();
      const cellsHtml: string[] = [];
      for (let col = 0; col <= maxRenderableCol; col += 1) {
        const key = spreadsheetCellKey(rowIndex, col);
        if (coveredByMerge.has(key)) continue;

        const cell = row.get(col);
        const merge = mergeOrigins.get(key);
        const plainText = cell?.plainText?.trim() ?? '';
        const isHeadingMerge = Boolean(
          merge &&
          merge.colspan > 1 &&
          rowIndex <= minRow + 4 &&
          plainText.length > 0 &&
          plainText.length <= 160
        );

        const cellCss = buildSpreadsheetCellCss(cell?.cellStyle, {
          forceCenter: Boolean(isHeadingMerge && !cell?.cellStyle?.textAlign),
          forceMiddle: Boolean((merge && merge.rowspan > 1) || (isHeadingMerge && !cell?.cellStyle?.verticalAlign)),
        });
        const needsHeadingBold = isHeadingMerge && !cell?.textStyle.bold;

        const attrs: string[] = [];
        if (cellCss || needsHeadingBold) {
          const mergedCss = [cellCss, needsHeadingBold ? 'font-weight:700' : ''].filter(Boolean).join(';');
          attrs.push(`style="${mergedCss}"`);
        }
        if (merge && merge.rowspan > 1) attrs.push(`rowspan="${merge.rowspan}"`);
        if (merge && merge.colspan > 1) attrs.push(`colspan="${merge.colspan}"`);

        const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
        cellsHtml.push(`<td${attrText}>${cell?.contentHtml ?? '&nbsp;'}</td>`);
      }
      rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`);
    }

    renderedSheets.push(
      `<section class="ofv-sheet"><div class="ofv-sheet-header"><h3>${escapeHtml(sheet.name)}</h3></div><div class="ofv-sheet-body"><table>${colgroup}<tbody>${rowsHtml.join('')}</tbody></table></div></section>`
    );
  }

  if (renderedSheets.length === 0) return null;
  return wrapPreview(fileName, renderedSheets.join(''));
}

function parseSlideRunStyle(runProps: Element | null): InlineStyle {
  if (!runProps) return {};
  const style: InlineStyle = {};

  const bold = getAttributeByLocalName(runProps, 'b');
  if (bold) style.bold = ['1', 'true', 'on'].includes(bold.toLowerCase());
  const italic = getAttributeByLocalName(runProps, 'i');
  if (italic) style.italic = ['1', 'true', 'on'].includes(italic.toLowerCase());
  const underline = getAttributeByLocalName(runProps, 'u');
  if (underline) style.underline = !['none', '0', 'false', 'off'].includes(underline.toLowerCase());
  const strike = getAttributeByLocalName(runProps, 'strike');
  if (strike) style.strike = !['nostrike', 'none', '0', 'false', 'off'].includes(strike.toLowerCase());

  const sizeRaw = Number(getAttributeByLocalName(runProps, 'sz'));
  if (Number.isFinite(sizeRaw) && sizeRaw > 0) style.fontSizePt = sizeRaw / 100;

  const solidFill = getFirstChildByLocalName(runProps, 'solidFill');
  const rgb = getAttributeByLocalName(getFirstChildByLocalName(solidFill ?? runProps, 'srgbClr') ?? runProps, 'val');
  style.color = normalizeHexColor(rgb);
  return style;
}

function renderSlideParagraph(paragraph: Element): string {
  const pPr = getFirstChildByLocalName(paragraph, 'pPr');
  const align = mapSlideAlignment(getAttributeByLocalName(pPr ?? paragraph, 'algn'));
  let html = '';

  for (const child of Array.from(paragraph.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;

    if (element.localName === 'r') {
      const rPr = getFirstChildByLocalName(element, 'rPr');
      const style = parseSlideRunStyle(rPr);
      const t = getFirstChildByLocalName(element, 't');
      html += wrapRunText(t?.textContent ?? '', style);
      continue;
    }

    if (element.localName === 'fld') {
      const rPr = getFirstChildByLocalName(element, 'rPr');
      const style = parseSlideRunStyle(rPr);
      const t = getFirstChildByLocalName(element, 't');
      html += wrapRunText(t?.textContent ?? '', style);
      continue;
    }

    if (element.localName === 'br') {
      html += '<br />';
    }
  }

  return renderParagraph(html, align);
}

async function buildPptxPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? '0');
      const bNum = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? '0');
      return aNum - bNum;
    });
  if (slidePaths.length === 0) return null;

  const slidesHtml: string[] = [];
  for (let i = 0; i < Math.min(slidePaths.length, 40); i += 1) {
    const slideXml = await readZipTextIfExists(zip, slidePaths[i]);
    if (!slideXml) continue;
    const slideDoc = parseXml(slideXml);
    if (!slideDoc) continue;

    const blocks: string[] = [];
    for (const txBody of getDescendantsByLocalName(slideDoc, 'txBody')) {
      const pList = getChildElementsByLocalName(txBody, 'p');
      const rendered = pList.map((p) => renderSlideParagraph(p)).join('');
      if (rendered.trim()) blocks.push(rendered);
    }

    const title = `Slide ${i + 1}`;
    slidesHtml.push(
      `<section class="ofv-slide"><div class="ofv-slide-header"><h3>${title}</h3></div><div class="ofv-slide-body">${blocks.join('<div class="ofv-separator"></div>') || '<p class="ofv-empty">No preview text found on this slide.</p>'}</div></section>`
    );
  }

  return wrapPreview(fileName, slidesHtml.join(''));
}

function parseOdfStyles(...xmlDocs: Array<string | null>): Map<string, OdfStyleEntry> {
  const rawStyles = new Map<string, OdfRawStyle>();
  const styleMap = new Map<string, OdfStyleEntry>();

  for (const xml of xmlDocs) {
    if (!xml) continue;
    const doc = parseXml(xml);
    if (!doc) continue;
    for (const styleElement of getDescendantsByLocalName(doc, 'style')) {
      const name = getAttributeByLocalName(styleElement, 'name');
      if (!name) continue;

      const parentStyleName = getAttributeByLocalName(styleElement, 'parent-style-name') ?? undefined;
      const existing = rawStyles.get(name);
      const textStyle: InlineStyle = existing?.text ? { ...existing.text } : {};
      let align = existing?.align;

      const textProps = getFirstChildByLocalName(styleElement, 'text-properties');
      const pProps = getFirstChildByLocalName(styleElement, 'paragraph-properties');
      if (textProps) {
        const weight = getAttributeByLocalName(textProps, 'font-weight');
        const fontStyle = getAttributeByLocalName(textProps, 'font-style');
        const underline = getAttributeByLocalName(textProps, 'text-underline-style');
        const color = getAttributeByLocalName(textProps, 'color');
        const fontSize = getAttributeByLocalName(textProps, 'font-size');

        if (weight && weight.toLowerCase() === 'bold') textStyle.bold = true;
        if (fontStyle && fontStyle.toLowerCase() === 'italic') textStyle.italic = true;
        if (underline && underline.toLowerCase() !== 'none') textStyle.underline = true;
        textStyle.color = normalizeHexColor(color) ?? textStyle.color;

        if (fontSize && fontSize.toLowerCase().endsWith('pt')) {
          const num = Number(fontSize.slice(0, -2));
          if (Number.isFinite(num)) textStyle.fontSizePt = num;
        }
      }
      if (pProps) {
        const paragraphAlign = getAttributeByLocalName(pProps, 'text-align');
        align = mapWordAlignment(paragraphAlign) ?? align;
      }

      rawStyles.set(name, {
        parentStyleName: parentStyleName ?? existing?.parentStyleName,
        align,
        text: textStyle,
      });
    }
  }

  const resolving = new Set<string>();
  const resolveStyle = (name: string): OdfStyleEntry => {
    const cached = styleMap.get(name);
    if (cached) return cached;
    const raw = rawStyles.get(name);
    if (!raw) return {};

    if (resolving.has(name)) {
      return { align: raw.align, text: raw.text };
    }
    resolving.add(name);

    let inherited: OdfStyleEntry = {};
    if (raw.parentStyleName && rawStyles.has(raw.parentStyleName)) {
      inherited = resolveStyle(raw.parentStyleName);
    }

    const resolved: OdfStyleEntry = {
      align: raw.align ?? inherited.align,
      text: raw.text ? mergeStyles(inherited.text ?? {}, raw.text) : inherited.text,
    };
    resolving.delete(name);
    styleMap.set(name, resolved);
    return resolved;
  };

  for (const name of rawStyles.keys()) {
    if (!styleMap.has(name)) {
      styleMap.set(name, resolveStyle(name));
    }
  }
  return styleMap;
}

function renderOdfInlineContent(node: Node, styleMap: Map<string, OdfStyleEntry>, inherited: InlineStyle): string {
  if (node.nodeType === Node.TEXT_NODE) return wrapRunText(node.textContent ?? '', inherited);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  if (element.localName === 's') {
    const count = Number(getAttributeByLocalName(element, 'c') ?? '1');
    return wrapRunText(' '.repeat(Math.max(1, Math.min(20, count))), inherited);
  }
  if (element.localName === 'tab') return wrapRunText('\t', inherited);
  if (element.localName === 'line-break') return '<br />';

  const styleName = getAttributeByLocalName(element, 'style-name');
  const styleEntry = styleName ? styleMap.get(styleName) : undefined;
  const merged = styleEntry?.text ? mergeStyles(inherited, styleEntry.text) : inherited;

  let html = '';
  for (const child of Array.from(element.childNodes)) {
    html += renderOdfInlineContent(child, styleMap, merged);
  }
  return html;
}

async function buildOdtPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const contentXml = await readZipTextIfExists(zip, 'content.xml');
  if (!contentXml) return null;
  const stylesXml = await readZipTextIfExists(zip, 'styles.xml');
  const styleMap = parseOdfStyles(contentXml, stylesXml);

  const doc = parseXml(contentXml);
  if (!doc) return null;
  const textRoot = getDescendantsByLocalName(doc, 'text')[0];
  if (!textRoot) return null;

  const blocks: string[] = [];
  for (const child of Array.from(textRoot.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (element.localName !== 'p' && element.localName !== 'h') continue;

    const styleName = getAttributeByLocalName(element, 'style-name');
    const styleEntry = styleName ? styleMap.get(styleName) : undefined;
    const directAlign = mapWordAlignment(getAttributeByLocalName(element, 'text-align'));
    const align = directAlign ?? styleEntry?.align;

    let inlineHtml = '';
    for (const inlineNode of Array.from(element.childNodes)) {
      inlineHtml += renderOdfInlineContent(inlineNode, styleMap, {});
    }
    blocks.push(renderParagraph(inlineHtml, align));
  }

  return wrapPreview(fileName, blocks.join('') || '<p class="ofv-empty">No readable content found.</p>');
}

async function buildOdsPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const contentXml = await readZipTextIfExists(zip, 'content.xml');
  if (!contentXml) return null;
  const stylesXml = await readZipTextIfExists(zip, 'styles.xml');
  const styleMap = parseOdfStyles(contentXml, stylesXml);

  const doc = parseXml(contentXml);
  if (!doc) return null;
  const tableElements = getDescendantsByLocalName(doc, 'table');
  if (tableElements.length === 0) return null;

  const renderedTables: string[] = [];
  for (const tableEl of tableElements.slice(0, 12)) {
    const name = getAttributeByLocalName(tableEl, 'name') ?? 'Sheet';
    const rowsHtml: string[] = [];
    let rowCount = 0;

    for (const rowEl of getChildElementsByLocalName(tableEl, 'table-row')) {
      if (rowCount >= 500) break;
      const rowRepeat = Math.max(1, Math.min(50, Number(getAttributeByLocalName(rowEl, 'number-rows-repeated') ?? '1')));
      const cellHtml: string[] = [];

      for (const cellEl of getChildElementsByLocalName(rowEl, 'table-cell')) {
        const repeat = Math.max(1, Math.min(100, Number(getAttributeByLocalName(cellEl, 'number-columns-repeated') ?? '1')));
        const styleName = getAttributeByLocalName(cellEl, 'style-name');
        const styleEntry = styleName ? styleMap.get(styleName) : undefined;

        const paragraphs = getChildElementsByLocalName(cellEl, 'p');
        const text = paragraphs.map((p) => p.textContent ?? '').join('\n');
        const textHtml = richTextFromPlain(text).html || '&nbsp;';
        const css = styleEntry
          ? styleToCss({ ...(styleEntry.text ?? {}), align: styleEntry.align })
          : '';
        const cellValue = css ? `<span style="${css}">${textHtml}</span>` : textHtml;

        for (let i = 0; i < repeat; i += 1) {
          cellHtml.push(`<td>${cellValue}</td>`);
        }
      }

      for (let r = 0; r < rowRepeat; r += 1) {
        rowsHtml.push(`<tr>${cellHtml.join('')}</tr>`);
        rowCount += 1;
        if (rowCount >= 500) break;
      }
    }

    renderedTables.push(
      `<section class="ofv-sheet"><div class="ofv-sheet-header"><h3>${escapeHtml(name)}</h3></div><div class="ofv-sheet-body"><table><tbody>${rowsHtml.join('')}</tbody></table></div></section>`
    );
  }

  return wrapPreview(fileName, renderedTables.join(''));
}

async function buildOdpPreview(fileBytes: Uint8Array, fileName: string): Promise<OfficePreviewData | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const contentXml = await readZipTextIfExists(zip, 'content.xml');
  if (!contentXml) return null;
  const stylesXml = await readZipTextIfExists(zip, 'styles.xml');
  const styleMap = parseOdfStyles(contentXml, stylesXml);

  const doc = parseXml(contentXml);
  if (!doc) return null;
  const pages = getDescendantsByLocalName(doc, 'page');
  if (pages.length === 0) return null;

  const slides: string[] = [];
  for (let i = 0; i < Math.min(pages.length, 40); i += 1) {
    const page = pages[i];
    const title = getAttributeByLocalName(page, 'name') ?? `Slide ${i + 1}`;
    const pElements = getDescendantsByLocalName(page, 'p');
    const bodyParts: string[] = [];

    for (const p of pElements) {
      const styleName = getAttributeByLocalName(p, 'style-name');
      const styleEntry = styleName ? styleMap.get(styleName) : undefined;
      const directAlign = mapWordAlignment(getAttributeByLocalName(p, 'text-align'));
      let inlineHtml = '';
      for (const child of Array.from(p.childNodes)) {
        inlineHtml += renderOdfInlineContent(child, styleMap, styleEntry?.text ?? {});
      }
      bodyParts.push(renderParagraph(inlineHtml, directAlign ?? styleEntry?.align));
    }

    slides.push(
      `<section class="ofv-slide"><div class="ofv-slide-header"><h3>${escapeHtml(title)}</h3></div><div class="ofv-slide-body">${bodyParts.join('') || '<p class="ofv-empty">No preview text found on this slide.</p>'}</div></section>`
    );
  }

  return wrapPreview(fileName, slides.join(''));
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.filter((line) => line.length > 0).map((line) => splitDelimitedLine(line, delimiter));
}

function buildDelimitedPreview(fileBytes: Uint8Array, fileName: string, delimiter: ',' | '\t'): OfficePreviewData {
  const text = safeDecodeUtf8(fileBytes);
  const rows = parseDelimited(text, delimiter);
  const tableRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      const value = richTextFromPlain(cell).html || '&nbsp;';
      return `<${tag}>${value}</${tag}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });

  return wrapPreview(fileName, `<section class="ofv-sheet"><div class="ofv-sheet-body"><table><tbody>${tableRows.join('')}</tbody></table></div></section>`);
}

function buildTextPreview(fileBytes: Uint8Array, fileName: string): OfficePreviewData {
  const text = safeDecodeUtf8(fileBytes);
  return wrapPreview(fileName, `<p>${richTextFromPlain(text).html}</p>`);
}

function buildRtfPreview(fileBytes: Uint8Array, fileName: string): OfficePreviewData {
  const text = safeDecodeUtf8(fileBytes);
  let bold = false;
  let italic = false;
  let underline = false;
  let align: TextAlign = 'left';
  let html = '';
  let paragraph = '';

  const flushParagraph = () => {
    html += renderParagraph(paragraph, align);
    paragraph = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '}') {
      i += 1;
      continue;
    }
    if (ch !== '\\') {
      paragraph += wrapRunText(ch, { bold, italic, underline });
      i += 1;
      continue;
    }

    i += 1;
    if (i >= text.length) break;

    const control = text[i];
    if (control === '\\' || control === '{' || control === '}') {
      paragraph += wrapRunText(control, { bold, italic, underline });
      i += 1;
      continue;
    }

    if (control === "'") {
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        paragraph += wrapRunText(String.fromCharCode(Number.parseInt(hex, 16)), { bold, italic, underline });
        i += 3;
        continue;
      }
    }

    const start = i;
    while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1;
    const word = text.slice(start, i).toLowerCase();

    let sign = '';
    if (text[i] === '+' || text[i] === '-') {
      sign = text[i];
      i += 1;
    }
    let num = '';
    while (i < text.length && /[0-9]/.test(text[i])) {
      num += text[i];
      i += 1;
    }
    const value = num ? Number(`${sign}${num}`) : undefined;
    if (text[i] === ' ') i += 1;

    if (word === 'par' || word === 'line') {
      flushParagraph();
      continue;
    }
    if (word === 'tab') {
      paragraph += wrapRunText('\t', { bold, italic, underline });
      continue;
    }
    if (word === 'b') {
      bold = value === undefined ? true : value !== 0;
      continue;
    }
    if (word === 'i') {
      italic = value === undefined ? true : value !== 0;
      continue;
    }
    if (word === 'ul') {
      underline = value === undefined ? true : value !== 0;
      continue;
    }
    if (word === 'ulnone') {
      underline = false;
      continue;
    }
    if (word === 'plain') {
      bold = false;
      italic = false;
      underline = false;
      continue;
    }
    if (word === 'ql') {
      align = 'left';
      continue;
    }
    if (word === 'qr') {
      align = 'right';
      continue;
    }
    if (word === 'qc') {
      align = 'center';
      continue;
    }
    if (word === 'qj') {
      align = 'justify';
      continue;
    }
  }

  if (paragraph.trim().length > 0 || !html.trim()) flushParagraph();
  return wrapPreview(fileName, html);
}
