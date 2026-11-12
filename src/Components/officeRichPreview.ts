/**
 * Formatting-faithful previews for Word (.docx) and PowerPoint (.pptx).
 *
 * Renders the document's own formatting to HTML (no external tools, works
 * offline, everything stays in memory):
 *  - Word: pages with the document's paper size and margins, headers/footers,
 *    fonts, bold/italic/underline/strike, colours, highlight, sub/superscript,
 *    caps, alignment (left/right/center/justify), indents, line spacing,
 *    paragraph spacing/borders/shading, bullets & numbering, tables (merged
 *    cells, shading, borders, widths), images, page breaks, page numbers.
 *  - PowerPoint: each slide at its real size/aspect with every shape at its
 *    position: backgrounds, master/layout graphics, text boxes with the
 *    inherited text styles, bullets, alignment, fills, outlines, rotation,
 *    pictures (with cropping), groups, tables and SmartArt.
 *
 * Used by officePreview.ts; if anything here fails, the simpler preview is used.
 */
import JSZip from 'jszip';

export interface RichPreviewResult {
  kind: 'html';
  title: string;
  html: string;
}

// ---------------------------------------------------------------------------
// XML helpers (matched by local name, so namespace prefixes don't matter)
// ---------------------------------------------------------------------------

function parseXml(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name) return a.value;
  }
  return null;
}

function numAttr(el: Element | null | undefined, name: string): number | undefined {
  const raw = attr(el, name);
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function kids(el: Element | null | undefined): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1 && (c as Element).localName === name) return c as Element;
  }
  return null;
}

function children(el: Element | null | undefined, name: string): Element[] {
  return kids(el).filter((c) => c.localName === name);
}

function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null | undefined = el;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}

function descendants(root: Document | Element | null | undefined, name: string): Element[] {
  if (!root) return [];
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
}

function firstDescendant(root: Document | Element | null | undefined, name: string): Element | null {
  return descendants(root, name)[0] ?? null;
}

/** OOXML on/off property: present and not val="0|false|off|none". */
function isOn(el: Element | null | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, 'val');
  if (v === null) return true;
  return !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number, digits = 2): string {
  return Number(n.toFixed(digits)).toString();
}

function fontStack(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const clean = name.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim();
  if (!clean) return undefined;
  const serif = /times|georgia|cambria|garamond|book|serif|palatino|baskerville|century/i.test(clean) && !/sans/i.test(clean);
  const mono = /courier|consolas|mono/i.test(clean);
  return `'${clean}', ${mono ? 'monospace' : serif ? 'serif' : 'sans-serif'}`;
}

// ---------------------------------------------------------------------------
// Package (zip) access: parts, relationships, images
// ---------------------------------------------------------------------------

interface Rel {
  target: string;
  type: string;
  external: boolean;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

function dirOf(partPath: string): string {
  const i = partPath.lastIndexOf('/');
  return i < 0 ? '' : partPath.slice(0, i);
}

function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const stack = dirOf(partPath).split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

class OfficePackage {
  private xmlCache = new Map<string, Document | null>();
  private relsCache = new Map<string, Map<string, Rel>>();
  private imageCache = new Map<string, string | null>();
  private zip: JSZip;

  constructor(zip: JSZip) {
    this.zip = zip;
  }

  async xml(partPath: string): Promise<Document | null> {
    if (this.xmlCache.has(partPath)) return this.xmlCache.get(partPath) ?? null;
    const entry = this.zip.file(partPath);
    const doc = entry ? parseXml(await entry.async('string')) : null;
    this.xmlCache.set(partPath, doc);
    return doc;
  }

  async rels(partPath: string): Promise<Map<string, Rel>> {
    const cached = this.relsCache.get(partPath);
    if (cached) return cached;
    const base = partPath.slice(partPath.lastIndexOf('/') + 1);
    const relsPath = `${dirOf(partPath) ? `${dirOf(partPath)}/` : ''}_rels/${base}.rels`;
    const map = new Map<string, Rel>();
    const doc = await this.xml(relsPath);
    for (const r of descendants(doc, 'Relationship')) {
      const id = attr(r, 'Id');
      const target = attr(r, 'Target');
      if (!id || !target) continue;
      const external = attr(r, 'TargetMode') === 'External';
      map.set(id, { target: external ? target : resolveTarget(partPath, target), type: attr(r, 'Type') ?? '', external });
    }
    this.relsCache.set(partPath, map);
    return map;
  }

  async relTargetByType(partPath: string, typeSuffix: string): Promise<string | null> {
    for (const rel of (await this.rels(partPath)).values()) {
      if (!rel.external && rel.type.endsWith(typeSuffix)) return rel.target;
    }
    return null;
  }

  async image(partPath: string): Promise<string | null> {
    if (this.imageCache.has(partPath)) return this.imageCache.get(partPath) ?? null;
    let url: string | null = null;
    const entry = this.zip.file(partPath);
    const ext = partPath.slice(partPath.lastIndexOf('.') + 1).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (entry && mime) {
      url = `data:${mime};base64,${await entry.async('base64')}`;
    }
    this.imageCache.set(partPath, url);
    return url;
  }

  /** Loads every image referenced (r:embed / r:id / r:link) in a part, keyed by rel id. */
  async imagesForPart(partPath: string, doc: Document | null): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!doc) return out;
    const rels = await this.rels(partPath);
    const ids = new Set<string>();
    for (const el of descendants(doc, 'blip')) {
      const id = attr(el, 'embed');
      if (id) ids.add(id);
    }
    for (const el of descendants(doc, 'imagedata')) {
      const id = attr(el, 'id');
      if (id) ids.add(id);
    }
    for (const id of ids) {
      const rel = rels.get(id);
      if (!rel || rel.external) continue;
      const url = await this.image(rel.target);
      if (url) out.set(id, url);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Theme & colours
// ---------------------------------------------------------------------------

interface Theme {
  colors: Record<string, string>;
  majorFont?: string;
  minorFont?: string;
}

const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

function parseTheme(doc: Document | null): Theme {
  const theme: Theme = { colors: { ...DEFAULT_THEME_COLORS } };
  if (!doc) return theme;
  const scheme = firstDescendant(doc, 'clrScheme');
  for (const c of kids(scheme)) {
    const value = kids(c)[0];
    if (!value) continue;
    const hex = value.localName === 'sysClr' ? attr(value, 'lastClr') : attr(value, 'val');
    if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) theme.colors[c.localName] = hex.toUpperCase();
  }
  const fontScheme = firstDescendant(doc, 'fontScheme');
  theme.majorFont = attr(path(fontScheme, 'majorFont', 'latin'), 'typeface') ?? undefined;
  theme.minorFont = attr(path(fontScheme, 'minorFont', 'latin'), 'typeface') ?? undefined;
  return theme;
}

const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
};

const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  ltGray: 'D3D3D3',
  dkGray: 'A9A9A9',
  orange: 'FFA500',
  purple: '800080',
  navy: '000080',
};

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Applies DrawingML colour modifiers (lumMod, lumOff, tint, shade, alpha, satMod). */
function applyColorMods(hex: string, colorEl: Element): string {
  let [r, g, b] = hexToRgb(hex);
  let alpha = 1;
  for (const mod of kids(colorEl)) {
    const val = (numAttr(mod, 'val') ?? 100000) / 100000;
    switch (mod.localName) {
      case 'lumMod':
      case 'lumOff':
      case 'satMod': {
        const [h, s0, l0] = rgbToHsl(r, g, b);
        let s = s0;
        let l = l0;
        if (mod.localName === 'lumMod') l = clamp(l * val);
        else if (mod.localName === 'lumOff') l = clamp(l + val);
        else s = clamp(s * val);
        [r, g, b] = hslToRgb(h, s, l);
        break;
      }
      case 'tint':
        r += (255 - r) * (1 - val);
        g += (255 - g) * (1 - val);
        b += (255 - b) * (1 - val);
        break;
      case 'shade':
        r *= val;
        g *= val;
        b *= val;
        break;
      case 'alpha':
        alpha = clamp(val);
        break;
      default:
        break;
    }
  }
  const to255 = (v: number) => Math.round(clamp(v, 0, 255));
  if (alpha < 1) return `rgba(${to255(r)},${to255(g)},${to255(b)},${fmt(alpha)})`;
  return `#${[r, g, b].map((v) => to255(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Resolves the colour inside a fill/colour container (e.g. a:solidFill, a:fontRef). */
function resolveColor(
  container: Element | null | undefined,
  theme: Theme,
  clrMap: Record<string, string> = DEFAULT_CLR_MAP,
  phColor?: string,
): string | undefined {
  if (!container) return undefined;
  const c = COLOR_TAGS.has(container.localName) ? container : kids(container).find((k) => COLOR_TAGS.has(k.localName));
  if (!c) return undefined;
  let hex: string | null = null;
  switch (c.localName) {
    case 'srgbClr':
      hex = attr(c, 'val');
      break;
    case 'sysClr':
      hex = attr(c, 'lastClr') ?? (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000');
      break;
    case 'prstClr':
      hex = PRESET_COLORS[attr(c, 'val') ?? ''] ?? null;
      break;
    case 'scrgbClr': {
      const to = (v?: number) => Math.round(clamp((v ?? 0) / 100000) * 255).toString(16).padStart(2, '0');
      hex = `${to(numAttr(c, 'r'))}${to(numAttr(c, 'g'))}${to(numAttr(c, 'b'))}`;
      break;
    }
    case 'schemeClr': {
      const val = attr(c, 'val') ?? '';
      if (val === 'phClr') {
        if (!phColor) return undefined;
        hex = phColor.replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return phColor;
      } else {
        const mapped = clrMap[val] ?? DEFAULT_CLR_MAP[val] ?? val;
        hex = theme.colors[mapped] ?? null;
      }
      break;
    }
    default:
      break;
  }
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return applyColorMods(hex.toUpperCase(), c);
}

// ---------------------------------------------------------------------------
// Numbering formats (shared)
// ---------------------------------------------------------------------------

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function toLetters(n: number): string {
  if (n <= 0) return String(n);
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return toLetters(n).toLowerCase();
    case 'upperLetter':
      return toLetters(n);
    case 'lowerRoman':
      return toRoman(n).toLowerCase();
    case 'upperRoman':
      return toRoman(n);
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** Symbol / Wingdings bullet glyphs → visible Unicode characters. */
function normalizeBulletChar(ch: string, font?: string | null): string {
  if (!ch) return '•';
  const code = ch.charCodeAt(0);
  const symbolMap: Record<number, string> = {
    0xb7: '•', 0xa7: '▪', 0xd8: '➢', 0xfc: '✓', 0x76: '❖', 0x71: '❑', 0x6e: '■', 0x6c: '●',
    0xa8: '◆', 0x9f: '•', 0x77: '⬥', 0xe0: '➔', 0xe8: '➔', 0xf0: '⇨',
  };
  const lowered = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  if (code >= 0xf000 && code <= 0xf0ff) return symbolMap[lowered] ?? '•';
  if (font && /wingdings|symbol|webdings/i.test(font)) return symbolMap[lowered] ?? '•';
  if (ch === 'o' && font && /courier/i.test(font)) return '◦';
  return ch;
}

// ===========================================================================
// WORD (.docx)
// ===========================================================================

type Align = 'left' | 'right' | 'center' | 'justify';

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  sizePt?: number;
  font?: string;
  highlight?: string;
  shading?: string;
  vert?: 'super' | 'sub';
  caps?: boolean;
  smallCaps?: boolean;
  hidden?: boolean;
}

interface Border {
  widthPt: number;
  color: string;
  style: string;
}

interface ParaProps {
  align?: Align;
  beforePt?: number;
  afterPt?: number;
  line?: number;
  lineRule?: string;
  indLeftPt?: number;
  indRightPt?: number;
  firstLinePt?: number;
  hangingPt?: number;
  numId?: string;
  ilvl?: number;
  shading?: string;
  borderTop?: Border;
  borderBottom?: Border;
  borderLeft?: Border;
  borderRight?: Border;
  pageBreakBefore?: boolean;
  contextualSpacing?: boolean;
}

function mergeDefined<T extends object>(...layers: Array<T | undefined>): T {
  const out = {} as T;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF',
};

const twipsToPt = (v?: number) => (v === undefined ? undefined : v / 20);

function wordColor(val: string | null): string | undefined {
  if (!val || val === 'auto' || !/^[0-9a-fA-F]{6}$/.test(val)) return undefined;
  return `#${val.toUpperCase()}`;
}

function parseRunProps(rPr: Element | null | undefined, theme: Theme): RunProps | undefined {
  if (!rPr) return undefined;
  const rp: RunProps = {};
  rp.bold = isOn(child(rPr, 'b'));
  rp.italic = isOn(child(rPr, 'i'));
  const u = child(rPr, 'u');
  if (u) rp.underline = (attr(u, 'val') ?? 'single') !== 'none';
  const strike = isOn(child(rPr, 'strike')) ?? isOn(child(rPr, 'dstrike'));
  if (strike !== undefined) rp.strike = strike;
  rp.caps = isOn(child(rPr, 'caps'));
  rp.smallCaps = isOn(child(rPr, 'smallCaps'));
  rp.hidden = isOn(child(rPr, 'vanish'));
  rp.color = wordColor(attr(child(rPr, 'color'), 'val'));
  const sz = numAttr(child(rPr, 'sz'), 'val');
  if (sz) rp.sizePt = sz / 2;
  const fonts = child(rPr, 'rFonts');
  if (fonts) {
    const themeRef = attr(fonts, 'asciiTheme') ?? attr(fonts, 'hAnsiTheme');
    const themed = themeRef ? (themeRef.startsWith('major') ? theme.majorFont : theme.minorFont) : undefined;
    rp.font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? themed ?? attr(fonts, 'cs') ?? undefined;
    if (themeRef && themed) rp.font = themed;
  }
  const hl = attr(child(rPr, 'highlight'), 'val');
  if (hl && hl !== 'none') rp.highlight = HIGHLIGHT_COLORS[hl];
  const shd = wordColor(attr(child(rPr, 'shd'), 'fill'));
  if (shd) rp.shading = shd;
  const va = attr(child(rPr, 'vertAlign'), 'val');
  if (va === 'superscript') rp.vert = 'super';
  else if (va === 'subscript') rp.vert = 'sub';
  return rp;
}

function parseBorder(el: Element | null): Border | undefined {
  if (!el) return undefined;
  const style = attr(el, 'val') ?? 'single';
  if (style === 'nil' || style === 'none') return { widthPt: 0, color: 'transparent', style: 'none' };
  const sz = numAttr(el, 'sz') ?? 4; // eighths of a point
  const css = style === 'double' ? 'double' : style.includes('dash') ? 'dashed' : style.includes('dot') ? 'dotted' : 'solid';
  return { widthPt: Math.max(0.5, sz / 8), color: wordColor(attr(el, 'color')) ?? '#000000', style: css };
}

function mapJc(val: string | null): Align | undefined {
  switch (val) {
    case 'left':
    case 'start':
      return 'left';
    case 'right':
    case 'end':
      return 'right';
    case 'center':
      return 'center';
    case 'both':
    case 'distribute':
    case 'justify':
      return 'justify';
    default:
      return undefined;
  }
}

function parseParaProps(pPr: Element | null | undefined): ParaProps | undefined {
  if (!pPr) return undefined;
  const pp: ParaProps = {};
  pp.align = mapJc(attr(child(pPr, 'jc'), 'val'));
  const spacing = child(pPr, 'spacing');
  if (spacing) {
    pp.beforePt = attr(spacing, 'beforeAutospacing') === '1' ? 14 : twipsToPt(numAttr(spacing, 'before'));
    pp.afterPt = attr(spacing, 'afterAutospacing') === '1' ? 14 : twipsToPt(numAttr(spacing, 'after'));
    pp.line = numAttr(spacing, 'line');
    pp.lineRule = attr(spacing, 'lineRule') ?? (pp.line !== undefined ? 'auto' : undefined);
  }
  const ind = child(pPr, 'ind');
  if (ind) {
    pp.indLeftPt = twipsToPt(numAttr(ind, 'left') ?? numAttr(ind, 'start'));
    pp.indRightPt = twipsToPt(numAttr(ind, 'right') ?? numAttr(ind, 'end'));
    const hanging = numAttr(ind, 'hanging');
    const firstLine = numAttr(ind, 'firstLine');
    if (hanging !== undefined) {
      pp.hangingPt = hanging / 20;
      pp.firstLinePt = 0;
    } else if (firstLine !== undefined) {
      pp.firstLinePt = firstLine / 20;
      pp.hangingPt = 0;
    }
  }
  const numPr = child(pPr, 'numPr');
  if (numPr) {
    const numId = attr(child(numPr, 'numId'), 'val');
    if (numId !== null) pp.numId = numId;
    const ilvl = numAttr(child(numPr, 'ilvl'), 'val');
    if (ilvl !== undefined) pp.ilvl = ilvl;
  }
  pp.shading = wordColor(attr(child(pPr, 'shd'), 'fill'));
  const bdr = child(pPr, 'pBdr');
  if (bdr) {
    pp.borderTop = parseBorder(child(bdr, 'top'));
    pp.borderBottom = parseBorder(child(bdr, 'bottom'));
    pp.borderLeft = parseBorder(child(bdr, 'left'));
    pp.borderRight = parseBorder(child(bdr, 'right'));
  }
  pp.pageBreakBefore = isOn(child(pPr, 'pageBreakBefore'));
  pp.contextualSpacing = isOn(child(pPr, 'contextualSpacing'));
  return pp;
}

interface DocxStyleDef {
  type: string;
  basedOn?: string;
  p?: ParaProps;
  r?: RunProps;
  tblBorders?: Element | null;
  tblCellMar?: Element | null;
}

class DocxStyles {
  defs = new Map<string, DocxStyleDef>();
  defaultParagraph = 'Normal';
  defaultTable?: string;
  defaultsP?: ParaProps;
  defaultsR?: RunProps;
  private paraCache = new Map<string, { p: ParaProps; r: RunProps }>();

  constructor(doc: Document | null, theme: Theme) {
    if (!doc) return;
    const defaults = firstDescendant(doc, 'docDefaults');
    this.defaultsR = parseRunProps(path(defaults, 'rPrDefault', 'rPr'), theme);
    this.defaultsP = parseParaProps(path(defaults, 'pPrDefault', 'pPr'));
    for (const s of descendants(doc, 'style')) {
      const id = attr(s, 'styleId');
      const type = attr(s, 'type');
      if (!id || !type) continue;
      if (attr(s, 'default') === '1' || attr(s, 'default') === 'true') {
        if (type === 'paragraph') this.defaultParagraph = id;
        if (type === 'table') this.defaultTable = id;
      }
      const tblPr = child(s, 'tblPr');
      this.defs.set(id, {
        type,
        basedOn: attr(child(s, 'basedOn'), 'val') ?? undefined,
        p: parseParaProps(child(s, 'pPr')),
        r: parseRunProps(child(s, 'rPr'), theme),
        tblBorders: child(tblPr, 'tblBorders'),
        tblCellMar: child(tblPr, 'tblCellMar'),
      });
    }
  }

  private chain(id: string | undefined): DocxStyleDef[] {
    const out: DocxStyleDef[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const def = this.defs.get(cur);
      if (!def) break;
      out.unshift(def);
      cur = def.basedOn;
    }
    return out;
  }

  paragraph(id: string | undefined): { p: ParaProps; r: RunProps } {
    const key = id && this.defs.has(id) ? id : this.defaultParagraph;
    const cached = this.paraCache.get(key);
    if (cached) return cached;
    const chain = this.chain(key);
    const value = {
      p: mergeDefined<ParaProps>(...chain.map((d) => d.p)),
      r: mergeDefined<RunProps>(...chain.map((d) => d.r)),
    };
    this.paraCache.set(key, value);
    return value;
  }

  character(id: string | undefined): RunProps | undefined {
    if (!id) return undefined;
    return mergeDefined<RunProps>(...this.chain(id).map((d) => d.r));
  }

  table(id: string | undefined): { p: ParaProps; r: RunProps; borders?: Element | null; cellMar?: Element | null } {
    const chain = this.chain(id ?? this.defaultTable);
    let borders: Element | null | undefined;
    let cellMar: Element | null | undefined;
    for (const d of chain) {
      if (d.tblBorders) borders = d.tblBorders;
      if (d.tblCellMar) cellMar = d.tblCellMar;
    }
    return {
      p: mergeDefined<ParaProps>(...chain.map((d) => d.p)),
      r: mergeDefined<RunProps>(...chain.map((d) => d.r)),
      borders,
      cellMar,
    };
  }
}

interface NumLevel {
  start: number;
  format: string;
  text: string;
  p?: ParaProps;
  r?: RunProps;
  font?: string;
}

class DocxNumbering {
  private abstracts = new Map<string, Map<number, NumLevel>>();
  private nums = new Map<string, { abstractId: string; overrides: Map<number, { start?: number; level?: NumLevel }> }>();
  private counters = new Map<string, number[]>();
  private started = new Set<string>();

  constructor(doc: Document | null, theme: Theme) {
    if (!doc) return;
    const parseLevel = (lvl: Element): NumLevel => {
      const rPr = child(lvl, 'rPr');
      return {
        start: numAttr(child(lvl, 'start'), 'val') ?? 1,
        format: attr(child(lvl, 'numFmt'), 'val') ?? 'decimal',
        text: attr(child(lvl, 'lvlText'), 'val') ?? '',
        p: parseParaProps(child(lvl, 'pPr')),
        r: parseRunProps(rPr, theme),
        font: attr(child(rPr, 'rFonts'), 'ascii') ?? attr(child(rPr, 'rFonts'), 'hAnsi') ?? undefined,
      };
    };
    for (const a of descendants(doc, 'abstractNum')) {
      const id = attr(a, 'abstractNumId');
      if (!id) continue;
      const levels = new Map<number, NumLevel>();
      for (const lvl of children(a, 'lvl')) levels.set(numAttr(lvl, 'ilvl') ?? 0, parseLevel(lvl));
      this.abstracts.set(id, levels);
    }
    for (const n of descendants(doc, 'num')) {
      const id = attr(n, 'numId');
      const abstractId = attr(child(n, 'abstractNumId'), 'val');
      if (!id || !abstractId) continue;
      const overrides = new Map<number, { start?: number; level?: NumLevel }>();
      for (const o of children(n, 'lvlOverride')) {
        const lvl = child(o, 'lvl');
        overrides.set(numAttr(o, 'ilvl') ?? 0, {
          start: numAttr(child(o, 'startOverride'), 'val'),
          level: lvl ? parseLevel(lvl) : undefined,
        });
      }
      this.nums.set(id, { abstractId, overrides });
    }
  }

  level(numId: string, ilvl: number): NumLevel | undefined {
    const num = this.nums.get(numId);
    if (!num) return undefined;
    return num.overrides.get(ilvl)?.level ?? this.abstracts.get(num.abstractId)?.get(ilvl);
  }

  /** Advances the counter and returns the marker text, e.g. "2.", "b)", "•". */
  next(numId: string, ilvl: number): string | undefined {
    const num = this.nums.get(numId);
    const lvl = this.level(numId, ilvl);
    if (!num || !lvl) return undefined;
    const key = num.abstractId;
    let counters = this.counters.get(key);
    if (!counters) {
      counters = [];
      this.counters.set(key, counters);
    }
    // startOverride restarts this list the first time this num is used
    if (!this.started.has(numId)) {
      this.started.add(numId);
      for (const [l, o] of num.overrides) {
        if (o.start !== undefined) counters[l] = o.start - 1;
      }
    }
    const startOf = (l: number) => this.level(numId, l)?.start ?? 1;
    counters[ilvl] = (counters[ilvl] ?? startOf(ilvl) - 1) + 1;
    for (let l = ilvl + 1; l < 9; l += 1) counters[l] = startOf(l) - 1;

    if (lvl.format === 'bullet') return normalizeBulletChar(lvl.text, lvl.font);
    if (lvl.format === 'none') return lvl.text.replace(/%\d/g, '');
    return lvl.text.replace(/%(\d)/g, (_m, d: string) => {
      const l = Number(d) - 1;
      const lv = this.level(numId, l);
      return formatNumber(counters![l] ?? startOf(l), lv?.format ?? 'decimal');
    });
  }
}

interface DocxContext {
  pkg: OfficePackage;
  theme: Theme;
  styles: DocxStyles;
  numbering: DocxNumbering;
  images: Map<string, string>;
  page: { widthPt: number; heightPt: number; marginTopPt: number; marginLeftPt: number; marginRightPt: number };
  tableStyle?: { p: ParaProps; r: RunProps };
  inTable: boolean;
  /** Where absolutely-positioned (page-anchored) images are measured from; null = render them inline. */
  anchorOrigin: { leftPt: number; topPt: number } | null;
  /** Set while rendering a paragraph: drawings anchored to it mark it so it becomes their reference box. */
  paragraphAnchor?: { used: boolean };
}

interface InlineState {
  html: string;
  hasContent: boolean;
  /** Visible text was written (floating drawings alone don't give a paragraph its line). */
  hasText: boolean;
  fieldDepth: number;
  inInstr: boolean;
  instr: string;
  suppressResult: boolean;
  pageBreakBefore: boolean;
  pageBreakAfter: boolean;
}

const PAGE_TOKEN = '\u0001DVPAGE\u0001';
const PAGES_TOKEN = '\u0001DVPAGES\u0001';

/** Word's "single" line height relative to font size (the font's own line spacing). */
function singleLineFactor(font: string | undefined): number {
  const f = (font ?? '').toLowerCase();
  if (/calibri|carlito/.test(f)) return 1.22;
  if (/segoe/.test(f)) return 1.33;
  if (/cambria|georgia/.test(f)) return 1.17;
  if (/times|arial|helvetica|liberation/.test(f)) return 1.15;
  if (/verdana|tahoma/.test(f)) return 1.21;
  return 1.17;
}

function runCss(rp: RunProps): string {
  const css: string[] = [];
  if (rp.bold) css.push('font-weight:700');
  if (rp.italic) css.push('font-style:italic');
  const deco = [rp.underline ? 'underline' : '', rp.strike ? 'line-through' : ''].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
  if (rp.color) css.push(`color:${rp.color}`);
  if (rp.sizePt) css.push(`font-size:${fmt(rp.vert ? rp.sizePt * 0.65 : rp.sizePt)}pt`);
  else if (rp.vert) css.push('font-size:0.65em');
  const font = fontStack(rp.font);
  if (font) css.push(`font-family:${font}`);
  const bg = rp.highlight ?? rp.shading;
  if (bg) css.push(`background-color:${bg}`);
  if (rp.vert) css.push(`vertical-align:${rp.vert === 'super' ? 'super' : 'sub'}`);
  if (rp.caps) css.push('text-transform:uppercase');
  if (rp.smallCaps) css.push('font-variant:small-caps');
  return css.join(';');
}

function emitText(state: InlineState, text: string, rp: RunProps): void {
  if (!text || state.inInstr || state.suppressResult) return;
  const css = runCss(rp);
  const html = esc(text);
  state.html += css ? `<span style="${css}">${html}</span>` : html;
  state.hasContent = true;
  state.hasText = true;
}

/** Position (absolute when anchored to the page/margin) for a floating drawing; '' = keep it in the text flow. */
function anchorPositionCss(el: Element, ctx: DocxContext): string {
  const anchor = el.localName === 'anchor' ? el : firstDescendant(el, 'anchor');
  const origin = ctx.anchorOrigin;
  if (!anchor || ctx.inTable) return '';
  const posH = child(anchor, 'positionH');
  const posV = child(anchor, 'positionV');
  const relH = attr(posH, 'relativeFrom');
  const relV = attr(posV, 'relativeFrom');
  const offH = Number(child(posH, 'posOffset')?.textContent ?? NaN);
  const offV = Number(child(posV, 'posOffset')?.textContent ?? NaN);
  const pageRelative = (r: string | null) => r === 'page' || r === 'margin';
  if (!Number.isFinite(offH) || !Number.isFinite(offV)) return '';
  const behindDoc = attr(anchor, 'behindDoc') === '1';
  // Anchored to the paragraph/line (vertical) and column/margin (horizontal): position from the paragraph.
  if ((relV === 'paragraph' || relV === 'line') && ctx.paragraphAnchor) {
    ctx.paragraphAnchor.used = true;
    const leftPt = offH / 12700 - (relH === 'page' ? ctx.page.marginLeftPt : 0);
    return `position:absolute;left:${fmt(leftPt)}pt;top:${fmt(offV / 12700)}pt;z-index:${behindDoc ? -1 : 2};`;
  }
  const horizontalOk = pageRelative(relH) || relH === 'column';
  if (!origin || !horizontalOk || !pageRelative(relV)) return '';
  const leftPt = offH / 12700 + (relH === 'margin' || relH === 'column' ? ctx.page.marginLeftPt : 0) - origin.leftPt;
  const topPt = offV / 12700 + (relV === 'margin' ? ctx.page.marginTopPt : 0) - origin.topPt;
  return `position:absolute;left:${fmt(leftPt)}pt;top:${fmt(topPt)}pt;z-index:${behindDoc ? -1 : 2};`;
}

/**
 * Drawings that are not pictures: Word text boxes and shapes (wps:wsp / VML).
 * Text boxes render their own paragraphs inside a box with the shape's fill and outline.
 * Returns null when the drawing is a picture (handled by docxImage).
 */
function docxShape(el: Element, ctx: DocxContext): string | null {
  if (firstDescendant(el, 'blip') || firstDescendant(el, 'imagedata')) return null;
  const txbx = firstDescendant(el, 'txbxContent');
  const wsp = firstDescendant(el, 'wsp');
  const vmlShape = descendants(el, 'shape')[0] ?? descendants(el, 'rect')[0] ?? descendants(el, 'roundrect')[0] ?? null;

  const extent = firstDescendant(el, 'extent');
  let wPt = (numAttr(extent, 'cx') ?? 0) / 12700;
  let hPt = (numAttr(extent, 'cy') ?? 0) / 12700;
  const vmlStyle = attr(vmlShape, 'style') ?? '';
  if ((!wPt || !hPt) && vmlStyle) {
    const w = /width:\s*([\d.]+)pt/.exec(vmlStyle);
    const h = /height:\s*([\d.]+)pt/.exec(vmlStyle);
    if (w) wPt = Number(w[1]);
    if (h) hPt = Number(h[1]);
  }

  const css: string[] = ['box-sizing:border-box', 'overflow:visible'];
  const spPr = child(wsp, 'spPr');
  if (spPr) {
    const fill = child(spPr, 'noFill') ? undefined : resolveColor(child(spPr, 'solidFill'), ctx.theme);
    if (fill) css.push(`background:${fill}`);
    const ln = child(spPr, 'ln');
    const lnColor = ln && !child(ln, 'noFill') ? resolveColor(child(ln, 'solidFill'), ctx.theme) : undefined;
    if (lnColor) css.push(`border:${fmt(Math.max(0.5, (numAttr(ln, 'w') ?? 9525) / 12700))}pt solid ${lnColor}`);
  } else if (vmlShape) {
    const fill = attr(vmlShape, 'fillcolor');
    if (fill && attr(vmlShape, 'filled') !== 'f' && /^#[0-9a-f]{6}$/i.test(fill)) css.push(`background:${fill}`);
    const stroke = attr(vmlShape, 'strokecolor');
    if (stroke && attr(vmlShape, 'stroked') !== 'f' && /^#[0-9a-f]{6}$/i.test(stroke)) css.push(`border:0.75pt solid ${stroke}`);
  }
  const bodyPr = child(wsp, 'bodyPr');
  const ins = (name: string, def: number) => fmt((numAttr(bodyPr, name) ?? def) / 12700);
  // Text boxes get their inner margins; plain shapes (lines, bars) are drawn at their exact size.
  if (txbx) css.push(`padding:${ins('tIns', 45720)}pt ${ins('rIns', 91440)}pt ${ins('bIns', 45720)}pt ${ins('lIns', 91440)}pt`);
  else if (wPt && hPt) css.push(`height:${fmt(hPt)}pt`);
  if (wPt) css.push(`width:${fmt(wPt)}pt`);
  if (hPt) css.push(`min-height:${fmt(hPt)}pt`);

  const hasPaint = css.some((c) => c.startsWith('background') || c.startsWith('border'));
  if (!txbx && !hasPaint) return '';

  const position = anchorPositionCss(el, ctx);
  css.push(position || 'display:inline-block;vertical-align:top;text-indent:0;margin:2pt 0');
  // The box sits inside a paragraph, so its own paragraphs become block spans (a <p> can't contain a <p>).
  const inner = txbx
    ? renderDocxBlocks(kids(txbx), { ...ctx, anchorOrigin: null })
        .map((b) => b.html)
        .join('')
        .replace(/<p style="/g, '<span style="display:block;')
        .replace(/<\/p>/g, '</span>')
    : '';
  return `<span style="${css.join(';')};display:${position ? 'block' : 'inline-block'}">${inner}</span>`;
}

function docxDrawing(el: Element, ctx: DocxContext): string {
  return docxShape(el, ctx) ?? docxImage(el, ctx);
}

function docxImage(el: Element, ctx: DocxContext): string {
  const blip = firstDescendant(el, 'blip');
  const imagedata = firstDescendant(el, 'imagedata');
  const id = attr(blip, 'embed') ?? attr(imagedata, 'id');
  const src = id ? ctx.images.get(id) : undefined;
  const extent = firstDescendant(el, 'extent');
  let wPx = (numAttr(extent, 'cx') ?? 0) / 9525;
  let hPx = (numAttr(extent, 'cy') ?? 0) / 9525;
  if (!wPx || !hPx) {
    // VML: style="width:120pt;height:80pt"
    const shapeStyle = attr(firstDescendant(el, 'shape'), 'style') ?? '';
    const w = /width:\s*([\d.]+)pt/.exec(shapeStyle);
    const h = /height:\s*([\d.]+)pt/.exec(shapeStyle);
    if (w) wPx = Number(w[1]) * (96 / 72);
    if (h) hPx = Number(h[1]) * (96 / 72);
  }
  if (!src) {
    if (!wPx || !hPx) return '';
    return `<span style="display:inline-block;width:${fmt(wPx)}px;height:${fmt(hPx)}px;background:#f1f5f9;border:1px dashed #cbd5e1"></span>`;
  }
  const size = wPx && hPx ? `width:${fmt(wPx)}px;height:${fmt(hPx)}px;` : 'max-width:100%;';
  const anchor = descendants(el, 'anchor')[0] ?? (el.localName === 'anchor' ? el : null);
  if (anchor) {
    const position = anchorPositionCss(el, ctx);
    if (position) return `<img src="${src}" alt="" draggable="false" style="${position}${size}max-width:none" />`;
    const posH = child(anchor, 'positionH');
    const alignH = child(posH, 'align')?.textContent;
    if (alignH === 'right') return `<img src="${src}" alt="" draggable="false" style="float:right;margin:0 0 6pt 9pt;${size}max-width:100%" />`;
    if (alignH === 'left') return `<img src="${src}" alt="" draggable="false" style="float:left;margin:0 9pt 6pt 0;${size}max-width:100%" />`;
  }
  return `<img src="${src}" alt="" draggable="false" style="display:inline-block;vertical-align:baseline;${size}max-width:100%" />`;
}

function renderDocxInline(nodes: Element[], baseRun: RunProps, ctx: DocxContext, state: InlineState): void {
  for (const el of nodes) {
    switch (el.localName) {
      case 'r':
        renderDocxRun(el, baseRun, ctx, state);
        break;
      case 'hyperlink':
      case 'ins':
      case 'smartTag':
      case 'customXml':
      case 'moveTo':
      case 'dir':
      case 'bdo':
        renderDocxInline(kids(el), baseRun, ctx, state);
        break;
      case 'sdt':
        renderDocxInline(kids(child(el, 'sdtContent')), baseRun, ctx, state);
        break;
      case 'fldSimple': {
        const instr = (attr(el, 'instr') ?? '').trim().toUpperCase();
        if (instr.startsWith('PAGE')) emitText(state, PAGE_TOKEN, baseRun);
        else if (instr.startsWith('NUMPAGES')) emitText(state, PAGES_TOKEN, baseRun);
        else renderDocxInline(kids(el), baseRun, ctx, state);
        break;
      }
      case 'oMath':
      case 'oMathPara':
        emitText(state, el.textContent ?? '', baseRun);
        break;
      default:
        break; // del, bookmarks, proofing marks, comments...
    }
  }
}

function renderDocxRun(run: Element, baseRun: RunProps, ctx: DocxContext, state: InlineState): void {
  const rPr = child(run, 'rPr');
  const charStyle = ctx.styles.character(attr(child(rPr, 'rStyle'), 'val') ?? undefined);
  const rp = mergeDefined<RunProps>(baseRun, charStyle, parseRunProps(rPr, ctx.theme));
  if (rp.hidden) return;
  for (const c of kids(run)) {
    switch (c.localName) {
      case 't':
        emitText(state, c.textContent ?? '', rp);
        break;
      case 'tab':
      case 'ptab':
        emitText(state, '\t', rp);
        break;
      case 'br':
      case 'cr':
        if (attr(c, 'type') === 'page') {
          if (!state.hasContent) state.pageBreakBefore = true;
          else state.pageBreakAfter = true;
        } else if (!state.inInstr && !state.suppressResult) {
          state.html += '<br />';
        }
        break;
      case 'noBreakHyphen':
        emitText(state, '‑', rp);
        break;
      case 'sym': {
        const code = parseInt(attr(c, 'char') ?? '', 16);
        if (Number.isFinite(code)) emitText(state, normalizeBulletChar(String.fromCharCode(code), attr(c, 'font')), rp);
        break;
      }
      case 'fldChar': {
        const type = attr(c, 'fldCharType');
        if (type === 'begin') {
          state.fieldDepth += 1;
          state.inInstr = true;
          state.instr = '';
        } else if (type === 'separate') {
          state.inInstr = false;
          const instr = state.instr.trim().toUpperCase();
          if (instr.startsWith('PAGE') || instr.startsWith('NUMPAGES')) {
            state.suppressResult = false;
            emitText(state, instr.startsWith('PAGE') ? PAGE_TOKEN : PAGES_TOKEN, rp);
            state.suppressResult = true;
          }
        } else if (type === 'end') {
          state.fieldDepth = Math.max(0, state.fieldDepth - 1);
          state.inInstr = false;
          state.suppressResult = false;
        }
        break;
      }
      case 'instrText':
        state.instr += c.textContent ?? '';
        break;
      case 'drawing':
      case 'pict':
      case 'object':
        if (!state.inInstr && !state.suppressResult) {
          state.html += docxDrawing(c, ctx);
          state.hasContent = true;
        }
        break;
      case 'AlternateContent': {
        const fallback = child(c, 'Choice') ?? child(c, 'Fallback');
        const drawing = firstDescendant(fallback, 'drawing') ?? firstDescendant(fallback, 'pict');
        if (drawing) {
          state.html += docxDrawing(drawing, ctx);
          state.hasContent = true;
        }
        break;
      }
      case 'lastRenderedPageBreak':
        if (!state.hasContent && !ctx.inTable) state.pageBreakBefore = true;
        break;
      default:
        break;
    }
  }
}

function borderCss(side: string, b?: Border): string {
  if (!b) return '';
  if (b.style === 'none') return `border-${side}:none`;
  return `border-${side}:${fmt(b.widthPt)}pt ${b.style} ${b.color}`;
}

interface DocxBlock {
  html: string;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
}

function renderDocxParagraph(p: Element, ctx: DocxContext): DocxBlock {
  const pPr = child(p, 'pPr');
  const styleId = attr(child(pPr, 'pStyle'), 'val') ?? undefined;
  const style = ctx.styles.paragraph(styleId);
  const direct = parseParaProps(pPr);
  const numId = direct?.numId ?? style.p.numId;
  const ilvl = direct?.ilvl ?? style.p.ilvl ?? 0;
  const lvl = numId && numId !== '0' ? ctx.numbering.level(numId, ilvl) : undefined;

  const pp = mergeDefined<ParaProps>(ctx.styles.defaultsP, ctx.tableStyle?.p, style.p, lvl?.p, direct);
  const baseRun = mergeDefined<RunProps>(ctx.styles.defaultsR, ctx.tableStyle?.r, style.r);
  const markRun = mergeDefined<RunProps>(baseRun, parseRunProps(child(pPr, 'rPr'), ctx.theme));

  const state: InlineState = {
    html: '',
    hasContent: false,
    hasText: false,
    fieldDepth: 0,
    inInstr: false,
    instr: '',
    suppressResult: false,
    pageBreakBefore: false,
    pageBreakAfter: false,
  };
  const previousAnchor = ctx.paragraphAnchor;
  const paragraphAnchor = { used: false };
  ctx.paragraphAnchor = paragraphAnchor;
  renderDocxInline(kids(p).filter((k) => k.localName !== 'pPr'), baseRun, ctx, state);
  ctx.paragraphAnchor = previousAnchor;

  const sizePt = markRun.sizePt ?? 11;
  const css: string[] = [];
  css.push(`margin:${fmt(pp.beforePt ?? 0)}pt ${fmt(pp.indRightPt ?? 0)}pt ${fmt(pp.afterPt ?? 0)}pt ${fmt(pp.indLeftPt ?? 0)}pt`);
  if (pp.align) css.push(`text-align:${pp.align}`);
  if (pp.hangingPt) css.push(`text-indent:-${fmt(pp.hangingPt)}pt`);
  else if (pp.firstLinePt) css.push(`text-indent:${fmt(pp.firstLinePt)}pt`);
  const line = pp.line;
  if (line !== undefined && pp.lineRule === 'exact') css.push(`line-height:${fmt(line / 20)}pt`);
  else if (line !== undefined && pp.lineRule === 'atLeast') css.push(`line-height:${fmt(Math.max(line / 20, sizePt * singleLineFactor(markRun.font)))}pt`);
  else css.push(`line-height:${fmt(((line ?? 240) / 240) * singleLineFactor(markRun.font), 3)}`);
  css.push(`font-size:${fmt(sizePt)}pt`);
  const font = fontStack(markRun.font);
  if (font) css.push(`font-family:${font}`);
  if (pp.shading) css.push(`background-color:${pp.shading}`);
  if (paragraphAnchor.used) css.push('position:relative');
  for (const [side, b] of [['top', pp.borderTop], ['bottom', pp.borderBottom], ['left', pp.borderLeft], ['right', pp.borderRight]] as const) {
    const bc = borderCss(side, b);
    if (bc) css.push(bc, `padding-${side}:1pt`);
  }

  let marker = '';
  if (lvl && numId && state.hasContent) {
    const text = ctx.numbering.next(numId, ilvl);
    if (text) {
      const markerRun = mergeDefined<RunProps>(markRun, lvl.r, { underline: false, strike: false });
      const width = pp.hangingPt && pp.hangingPt > 0 ? `display:inline-block;min-width:${fmt(pp.hangingPt)}pt;text-indent:0;` : '';
      marker = `<span style="${width}${runCss(markerRun)}">${esc(text)}${width ? '' : ' '}</span>`;
    }
  } else if (lvl && numId) {
    // empty list paragraph: Word still advances nothing; keep layout only
  }

  const sectPr = child(pPr, 'sectPr');
  const sectionBreak = sectPr ? (attr(child(sectPr, 'type'), 'val') ?? 'nextPage') !== 'continuous' : false;

  return {
    // An empty paragraph (or one holding only floating drawings) still takes one line, as in Word.
    html: `<p style="${css.join(';')}">${marker}${state.html}${state.hasText ? '' : '&#8203;'}</p>`,
    pageBreakBefore: Boolean(pp.pageBreakBefore) || state.pageBreakBefore,
    pageBreakAfter: state.pageBreakAfter || sectionBreak,
  };
}

function cellMarginsCss(mar: Element | null | undefined): string | undefined {
  if (!mar) return undefined;
  const side = (n: string, alt: string) => {
    const el = child(mar, n) ?? child(mar, alt);
    const w = numAttr(el, 'w');
    return w === undefined ? undefined : fmt(w / 20);
  };
  const top = side('top', 'top');
  const right = side('right', 'end');
  const bottom = side('bottom', 'bottom');
  const left = side('left', 'start');
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) return undefined;
  return `padding:${top ?? 0}pt ${right ?? 5.4}pt ${bottom ?? 0}pt ${left ?? 5.4}pt`;
}

function renderDocxTable(tbl: Element, ctx: DocxContext): string {
  const tblPr = child(tbl, 'tblPr');
  const tStyle = ctx.styles.table(attr(child(tblPr, 'tblStyle'), 'val') ?? undefined);
  const bordersEl = child(tblPr, 'tblBorders') ?? tStyle.borders ?? null;
  const borders = {
    top: parseBorder(child(bordersEl, 'top')),
    bottom: parseBorder(child(bordersEl, 'bottom')),
    left: parseBorder(child(bordersEl, 'left') ?? child(bordersEl, 'start')),
    right: parseBorder(child(bordersEl, 'right') ?? child(bordersEl, 'end')),
    insideH: parseBorder(child(bordersEl, 'insideH')),
    insideV: parseBorder(child(bordersEl, 'insideV')),
  };
  const defaultCellPad = cellMarginsCss(child(tblPr, 'tblCellMar') ?? tStyle.cellMar) ?? 'padding:0 5.4pt';

  const gridCols = children(child(tbl, 'tblGrid'), 'gridCol').map((g) => (numAttr(g, 'w') ?? 0) / 20);
  const rows = children(tbl, 'tr');

  // Grid positions per cell, for vertical merges.
  interface CellInfo {
    el: Element;
    col: number;
    span: number;
    vMerge?: string;
  }
  const matrix: CellInfo[][] = rows.map((tr) => {
    let col = numAttr(child(child(tr, 'trPr'), 'gridBefore'), 'val') ?? 0;
    const cells: CellInfo[] = [];
    for (const tc of kids(tr).flatMap((k) => (k.localName === 'sdt' ? kids(child(k, 'sdtContent')) : [k])).filter((k) => k.localName === 'tc')) {
      const tcPr = child(tc, 'tcPr');
      const span = numAttr(child(tcPr, 'gridSpan'), 'val') ?? 1;
      const vm = child(tcPr, 'vMerge');
      cells.push({ el: tc, col, span, vMerge: vm ? attr(vm, 'val') ?? 'continue' : undefined });
      col += span;
    }
    return cells;
  });

  const prevCtx = { tableStyle: ctx.tableStyle, inTable: ctx.inTable };
  ctx.tableStyle = { p: tStyle.p, r: tStyle.r };
  ctx.inTable = true;

  const rowHtml = rows.map((tr, rowIndex) => {
    const trPr = child(tr, 'trPr');
    const h = numAttr(child(trPr, 'trHeight'), 'val');
    const cells = matrix[rowIndex].map((cell, cellIndex) => {
      if (cell.vMerge === 'continue') return '';
      let rowspan = 1;
      if (cell.vMerge === 'restart') {
        for (let r = rowIndex + 1; r < matrix.length; r += 1) {
          const below = matrix[r].find((c) => c.col === cell.col);
          if (below?.vMerge === 'continue') rowspan += 1;
          else break;
        }
      }
      const tcPr = child(cell.el, 'tcPr');
      const css: string[] = [];
      const isTop = rowIndex === 0;
      const isBottom = rowIndex + rowspan >= rows.length;
      const isLeft = cell.col === 0 && cellIndex === 0;
      const isRight = cellIndex === matrix[rowIndex].length - 1;
      const tcBorders = child(tcPr, 'tcBorders');
      const side = (name: string, alt: string, outer: Border | undefined, inner: Border | undefined, edge: boolean) =>
        parseBorder(child(tcBorders, name) ?? child(tcBorders, alt)) ?? (edge ? outer : inner);
      css.push(
        borderCss('top', side('top', 'top', borders.top, borders.insideH, isTop)) || 'border-top:none',
        borderCss('bottom', side('bottom', 'bottom', borders.bottom, borders.insideH, isBottom)) || 'border-bottom:none',
        borderCss('left', side('left', 'start', borders.left, borders.insideV, isLeft)) || 'border-left:none',
        borderCss('right', side('right', 'end', borders.right, borders.insideV, isRight)) || 'border-right:none',
      );
      const fill = wordColor(attr(child(tcPr, 'shd'), 'fill'));
      if (fill) css.push(`background-color:${fill}`);
      const vAlign = attr(child(tcPr, 'vAlign'), 'val');
      css.push(`vertical-align:${vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'bottom' : 'top'}`);
      const widthPt = gridCols.slice(cell.col, cell.col + cell.span).reduce((a, b) => a + b, 0);
      if (widthPt > 0) css.push(`width:${fmt(widthPt)}pt`);
      css.push(cellMarginsCss(child(tcPr, 'tcMar')) ?? defaultCellPad);
      const content = renderDocxBlocks(kids(cell.el), ctx).map((b) => b.html).join('');
      const span = `${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
      return `<td${span} style="${css.join(';')}">${content}</td>`;
    });
    return `<tr${h ? ` style="height:${fmt(h / 20)}pt"` : ''}>${cells.join('')}</tr>`;
  });

  ctx.tableStyle = prevCtx.tableStyle;
  ctx.inTable = prevCtx.inTable;

  const jc = attr(child(tblPr, 'jc'), 'val');
  const indPt = (numAttr(child(tblPr, 'tblInd'), 'w') ?? 0) / 20;
  const tblW = child(tblPr, 'tblW');
  const tblWType = attr(tblW, 'type');
  const tblWVal = numAttr(tblW, 'w');
  let width = '';
  if (tblWType === 'pct' && tblWVal) width = `width:${fmt(tblWVal > 100 ? tblWVal / 50 : tblWVal)}%;`;
  else if (tblWType === 'dxa' && tblWVal) width = `width:${fmt(tblWVal / 20)}pt;`;
  const margin = jc === 'center' ? 'margin:0 auto' : jc === 'right' || jc === 'end' ? 'margin:0 0 0 auto' : `margin:0 0 0 ${fmt(indPt)}pt`;
  return `<table style="border-collapse:collapse;table-layout:auto;${width}${margin}"><tbody>${rowHtml.join('')}</tbody></table>`;
}

function renderDocxBlocks(nodes: Element[], ctx: DocxContext): DocxBlock[] {
  const out: DocxBlock[] = [];
  for (const el of nodes) {
    switch (el.localName) {
      case 'p':
        out.push(renderDocxParagraph(el, ctx));
        break;
      case 'tbl':
        out.push({ html: renderDocxTable(el, ctx) });
        break;
      case 'sdt':
        out.push(...renderDocxBlocks(kids(child(el, 'sdtContent')), ctx));
        break;
      case 'customXml':
      case 'ins':
        out.push(...renderDocxBlocks(kids(el), ctx));
        break;
      default:
        break;
    }
  }
  return out;
}

async function renderDocxHeaderFooter(
  pkg: OfficePackage,
  partPath: string | null,
  ctx: DocxContext,
  anchorOrigin: { leftPt: number; topPt: number } | null,
): Promise<string> {
  if (!partPath) return '';
  const doc = await pkg.xml(partPath);
  const root = doc?.documentElement;
  if (!root) return '';
  const images = await pkg.imagesForPart(partPath, doc);
  const local: DocxContext = { ...ctx, images, anchorOrigin };
  return renderDocxBlocks(kids(root), local).map((b) => b.html).join('');
}

export async function buildRichDocxPreview(fileBytes: Uint8Array, fileName: string): Promise<RichPreviewResult | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const pkg = new OfficePackage(zip);
  const mainPath = 'word/document.xml';
  const doc = await pkg.xml(mainPath);
  const body = firstDescendant(doc, 'body');
  if (!doc || !body) return null;

  const theme = parseTheme(await pkg.xml((await pkg.relTargetByType(mainPath, '/theme')) ?? 'word/theme/theme1.xml'));
  const styles = new DocxStyles(await pkg.xml((await pkg.relTargetByType(mainPath, '/styles')) ?? 'word/styles.xml'), theme);
  const numbering = new DocxNumbering(await pkg.xml((await pkg.relTargetByType(mainPath, '/numbering')) ?? 'word/numbering.xml'), theme);

  // Page setup from the final section (applied to every page).
  const sectPr = children(body, 'sectPr').pop() ?? null;
  const pgSz = child(sectPr, 'pgSz');
  const pgMar = child(sectPr, 'pgMar');
  const page = {
    widthPt: (numAttr(pgSz, 'w') ?? 12240) / 20,
    heightPt: (numAttr(pgSz, 'h') ?? 15840) / 20,
    marginTopPt: Math.max(0, (numAttr(pgMar, 'top') ?? 1440) / 20),
    marginBottomPt: Math.max(0, (numAttr(pgMar, 'bottom') ?? 1440) / 20),
    marginLeftPt: (numAttr(pgMar, 'left') ?? 1440) / 20,
    marginRightPt: (numAttr(pgMar, 'right') ?? 1440) / 20,
    headerPt: (numAttr(pgMar, 'header') ?? 720) / 20,
    footerPt: (numAttr(pgMar, 'footer') ?? 720) / 20,
  };

  const ctx: DocxContext = {
    pkg,
    theme,
    styles,
    numbering,
    images: await pkg.imagesForPart(mainPath, doc),
    page,
    inTable: false,
    // Body content starts at the left/top margins (see page layout below).
    anchorOrigin: { leftPt: page.marginLeftPt, topPt: page.marginTopPt },
  };

  const blocks = renderDocxBlocks(kids(body), ctx);

  // Headers / footers (default ones; "first page" variants when the section asks for them).
  const rels = await pkg.rels(mainPath);
  const refPath = (kind: 'headerReference' | 'footerReference', type: string) => {
    const ref = children(sectPr, kind).find((r) => attr(r, 'type') === type);
    const id = attr(ref, 'id');
    const rel = id ? rels.get(id) : undefined;
    return rel && !rel.external ? rel.target : null;
  };
  const titlePg = isOn(child(sectPr, 'titlePg')) ?? false;
  // Header/footer floating items are positioned against the page itself (the header/footer
  // boxes are not positioned, so the page is their containing block).
  const headerOrigin = { leftPt: 0, topPt: 0 };
  const headerDefault = await renderDocxHeaderFooter(pkg, refPath('headerReference', 'default'), ctx, headerOrigin);
  const footerDefault = await renderDocxHeaderFooter(pkg, refPath('footerReference', 'default'), ctx, headerOrigin);
  const headerFirst = titlePg ? await renderDocxHeaderFooter(pkg, refPath('headerReference', 'first'), ctx, headerOrigin) : headerDefault;
  const footerFirst = titlePg ? await renderDocxHeaderFooter(pkg, refPath('footerReference', 'first'), ctx, headerOrigin) : footerDefault;

  // Split into pages at explicit page breaks / section breaks / Word's own last layout breaks.
  const pages: string[][] = [[]];
  blocks.forEach((b, i) => {
    if (b.pageBreakBefore && i > 0 && pages[pages.length - 1].length > 0) pages.push([]);
    pages[pages.length - 1].push(b.html);
    if (b.pageBreakAfter && i < blocks.length - 1) pages.push([]);
  });
  const nonEmpty = pages.filter((p) => p.length > 0);
  const total = Math.max(1, nonEmpty.length);

  const defaultsFont = fontStack(styles.paragraph(undefined).r.font ?? styles.defaultsR?.font ?? theme.minorFont) ?? "'Calibri', sans-serif";
  const pagesHtml = (nonEmpty.length ? nonEmpty : [['<p>&#8203;</p>']]).map((content, i) => {
    const header = i === 0 ? headerFirst : headerDefault;
    const footer = i === 0 ? footerFirst : footerDefault;
    // Header, body and footer each take their own space (like Word, the body is pushed
    // down when a header is taller than the top margin), so nothing overlaps.
    const html =
      `<div class="dv-page" style="width:${fmt(page.widthPt)}pt;min-height:${fmt(page.heightPt)}pt;padding:0 ${fmt(page.marginRightPt)}pt 0 ${fmt(page.marginLeftPt)}pt;font-family:${defaultsFont}">` +
      `<div class="dv-header" style="min-height:${fmt(page.marginTopPt)}pt;padding-top:${fmt(page.headerPt)}pt">${header}</div>` +
      `<div class="dv-body">${content.join('')}</div>` +
      `<div class="dv-footer" style="min-height:${fmt(page.marginBottomPt)}pt;padding-bottom:${fmt(page.footerPt)}pt">${footer}</div>` +
      '</div>';
    return html.split(PAGE_TOKEN).join(String(i + 1)).split(PAGES_TOKEN).join(String(total));
  });

  const styleBlock = `<style>
    .dv-doc{background:#e2e8f0;padding:20px 12px;overflow-x:auto;border-radius:8px;color:#000;}
    .dv-doc .dv-page{position:relative;isolation:isolate;display:flex;flex-direction:column;box-sizing:border-box;margin:0 auto 20px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.18);white-space:pre-wrap;word-wrap:break-word;tab-size:36pt;-moz-tab-size:36pt;text-align:left;line-height:normal;overflow:hidden;}
    .dv-doc .dv-page:last-child{margin-bottom:0}
    .dv-doc p{margin:0}
    .dv-doc table{border-spacing:0}
    .dv-doc td{box-sizing:border-box}
    .dv-doc img{display:inline-block}
    .dv-doc .dv-header{box-sizing:border-box;}
    .dv-doc .dv-body{position:relative;flex:1 0 auto;}
    .dv-doc .dv-footer{box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;}
  </style>`;
  return { kind: 'html', title: fileName, html: `${styleBlock}<div class="dv-doc">${pagesHtml.join('')}</div>` };
}

// ===========================================================================
// POWERPOINT (.pptx)
// ===========================================================================

interface SlidePart {
  path: string;
  doc: Document;
  images: Map<string, string>;
}

interface PptxContext {
  pkg: OfficePackage;
  theme: Theme;
  clrMap: Record<string, string>;
  cx: number;
  cy: number;
  slide: SlidePart;
  layout: SlidePart | null;
  master: SlidePart | null;
  defaultTextStyle: Element | null;
  slideNumber: number;
}

type Transform = (x: number, y: number, w: number, h: number) => [number, number, number, number];
const identity: Transform = (x, y, w, h) => [x, y, w, h];

function pct(v: number, total: number): string {
  return `${fmt((v / total) * 100, 4)}%`;
}

function cqw(emu: number, ctx: PptxContext): string {
  return `${fmt((emu / ctx.cx) * 100, 4)}cqw`;
}

function ptToCqw(pt: number, ctx: PptxContext): string {
  return cqw(pt * 12700, ctx);
}

function readXfrm(xfrm: Element | null): { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean } | null {
  if (!xfrm) return null;
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  if (!off || !ext) return null;
  return {
    x: numAttr(off, 'x') ?? 0,
    y: numAttr(off, 'y') ?? 0,
    w: numAttr(ext, 'cx') ?? 0,
    h: numAttr(ext, 'cy') ?? 0,
    rot: (numAttr(xfrm, 'rot') ?? 0) / 60000,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

interface Placeholder {
  type: string;
  idx?: string;
}

function placeholderOf(shape: Element): Placeholder | null {
  const nv = kids(shape).find((k) => k.localName.startsWith('nv'));
  const ph = path(nv, 'nvPr', 'ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') ?? undefined };
}

function masterTypeOf(type: string): string {
  if (type === 'ctrTitle') return 'title';
  if (type === 'subTitle' || type === 'obj' || type === 'tbl' || type === 'chart' || type === 'pic' || type === 'media' || type === 'clipArt' || type === 'dgm') return 'body';
  return type;
}

function findPlaceholder(part: SlidePart | null, ph: Placeholder, useIdx: boolean): Element | null {
  if (!part) return null;
  const shapes = descendants(part.doc, 'sp');
  if (useIdx && ph.idx !== undefined) {
    const byIdx = shapes.find((s) => placeholderOf(s)?.idx === ph.idx);
    if (byIdx) return byIdx;
  }
  const want = masterTypeOf(ph.type);
  return (
    shapes.find((s) => placeholderOf(s)?.type === ph.type) ??
    shapes.find((s) => {
      const t = placeholderOf(s)?.type;
      return t !== undefined && masterTypeOf(t) === want;
    }) ??
    null
  );
}

function backgroundCss(part: SlidePart | null, ctx: PptxContext): string | null {
  if (!part) return null;
  const bg = path(part.doc.documentElement, 'cSld', 'bg');
  if (!bg) return null;
  const bgPr = child(bg, 'bgPr');
  if (bgPr) return fillCss(bgPr, ctx, part) ?? null;
  const bgRef = child(bg, 'bgRef');
  if (bgRef) {
    const color = resolveColor(bgRef, ctx.theme, ctx.clrMap);
    if (color) return `background:${color}`;
  }
  return null;
}

/** CSS background for a shape/background properties element (solid, gradient, picture). */
function fillCss(spPr: Element, ctx: PptxContext, part: SlidePart, styleFill?: Element | null): string | undefined {
  if (child(spPr, 'noFill')) return 'background:transparent';
  const solid = child(spPr, 'solidFill');
  if (solid) {
    const c = resolveColor(solid, ctx.theme, ctx.clrMap);
    return c ? `background:${c}` : undefined;
  }
  const grad = child(spPr, 'gradFill');
  if (grad) {
    const stops = children(child(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 1000, color: resolveColor(gs, ctx.theme, ctx.clrMap) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos);
    if (stops.length > 0) {
      const ang = ((numAttr(child(grad, 'lin'), 'ang') ?? 0) / 60000 + 90) % 360;
      const list = stops.map((s) => `${s.color} ${fmt(s.pos)}%`).join(',');
      return child(grad, 'path') ? `background:radial-gradient(circle,${list})` : `background:linear-gradient(${fmt(ang)}deg,${list})`;
    }
  }
  const blipFill = child(spPr, 'blipFill');
  if (blipFill) {
    const id = attr(child(blipFill, 'blip'), 'embed');
    const src = id ? part.images.get(id) : undefined;
    if (src) {
      const tile = child(blipFill, 'tile');
      return tile ? `background:url("${src}") repeat` : `background:url("${src}") center / 100% 100% no-repeat`;
    }
  }
  if (styleFill && (numAttr(styleFill, 'idx') ?? 0) > 0) {
    const c = resolveColor(styleFill, ctx.theme, ctx.clrMap);
    if (c) return `background:${c}`;
  }
  return undefined;
}

function outlineCss(spPr: Element | null, ctx: PptxContext, styleLn?: Element | null): string | undefined {
  const ln = child(spPr, 'ln');
  if (ln && child(ln, 'noFill')) return undefined;
  let color = resolveColor(child(ln, 'solidFill'), ctx.theme, ctx.clrMap);
  let widthEmu = numAttr(ln, 'w');
  if (!color && styleLn && (numAttr(styleLn, 'idx') ?? 0) > 0 && !(ln && child(ln, 'noFill'))) {
    color = resolveColor(styleLn, ctx.theme, ctx.clrMap);
    widthEmu = widthEmu ?? 12700;
  }
  if (!color) return undefined;
  const w = cqw(Math.max(widthEmu ?? 9525, 6350), ctx);
  const dash = attr(child(ln, 'prstDash'), 'val');
  if (dash && dash !== 'solid') return `outline:${w} ${dash.includes('dot') ? 'dotted' : 'dashed'} ${color};outline-offset:calc(-1 * ${w})`;
  return `box-shadow:inset 0 0 0 ${w} ${color}`;
}

function geometryCss(spPr: Element | null): string {
  const prst = attr(child(spPr, 'prstGeom'), 'prst') ?? 'rect';
  switch (prst) {
    case 'ellipse':
    case 'circle':
      return 'border-radius:50%';
    case 'roundRect':
    case 'round2SameRect':
      return 'border-radius:12%/18%';
    case 'triangle':
      return 'clip-path:polygon(50% 0,100% 100%,0 100%)';
    case 'rtTriangle':
      return 'clip-path:polygon(0 0,100% 100%,0 100%)';
    case 'diamond':
      return 'clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)';
    case 'parallelogram':
      return 'clip-path:polygon(25% 0,100% 0,75% 100%,0 100%)';
    case 'trapezoid':
      return 'clip-path:polygon(25% 0,75% 0,100% 100%,0 100%)';
    case 'pentagon':
    case 'homePlate':
      return 'clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%)';
    case 'chevron':
      return 'clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%,20% 50%)';
    case 'hexagon':
      return 'clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)';
    case 'octagon':
      return 'clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)';
    case 'rightArrow':
      return 'clip-path:polygon(0 25%,60% 25%,60% 0,100% 50%,60% 100%,60% 75%,0 75%)';
    case 'leftArrow':
      return 'clip-path:polygon(40% 0,40% 25%,100% 25%,100% 75%,40% 75%,40% 100%,0 50%)';
    case 'upArrow':
      return 'clip-path:polygon(50% 0,100% 40%,75% 40%,75% 100%,25% 100%,25% 40%,0 40%)';
    case 'downArrow':
      return 'clip-path:polygon(25% 0,75% 0,75% 60%,100% 60%,50% 100%,0 60%,25% 60%)';
    case 'star5':
      return 'clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)';
    default:
      return '';
  }
}

function transformCss(rot: number, flipH: boolean, flipV: boolean): string {
  const parts: string[] = [];
  if (rot) parts.push(`rotate(${fmt(rot)}deg)`);
  if (flipH) parts.push('scaleX(-1)');
  if (flipV) parts.push('scaleY(-1)');
  return parts.length ? `transform:${parts.join(' ')}` : '';
}

/** Text-style sources for a shape, highest priority first (lstStyle → layout → master → txStyles → defaults). */
interface TextSources {
  lists: Array<Element | null>;
  bodyPrs: Array<Element | null>;
  fontRef: Element | null;
}

function textSourcesFor(shape: Element, ctx: PptxContext, layer: 'slide' | 'layout' | 'master'): TextSources {
  const txBody = child(shape, 'txBody');
  const lists: Array<Element | null> = [child(txBody, 'lstStyle')];
  const bodyPrs: Array<Element | null> = [child(txBody, 'bodyPr')];
  const ph = placeholderOf(shape);
  const masterTx = path(ctx.master?.doc.documentElement, 'txStyles');
  if (ph) {
    if (layer === 'slide') {
      const lph = findPlaceholder(ctx.layout, ph, true);
      lists.push(path(lph, 'txBody', 'lstStyle'));
      bodyPrs.push(path(lph, 'txBody', 'bodyPr'));
    }
    if (layer !== 'master') {
      const mph = findPlaceholder(ctx.master, ph, false);
      lists.push(path(mph, 'txBody', 'lstStyle'));
      bodyPrs.push(path(mph, 'txBody', 'bodyPr'));
    }
    const t = masterTypeOf(ph.type);
    lists.push(child(masterTx, t === 'title' ? 'titleStyle' : t === 'body' ? 'bodyStyle' : 'otherStyle'));
  } else {
    lists.push(child(masterTx, 'otherStyle'));
  }
  lists.push(ctx.defaultTextStyle);
  return { lists, bodyPrs, fontRef: path(shape, 'style', 'fontRef') };
}

function levelProps(lists: Array<Element | null>, lvl: number): Element[] {
  const name = `lvl${lvl + 1}pPr`;
  return lists.map((l) => child(l, name)).filter((e): e is Element => Boolean(e));
}

function slideFont(typeface: string | null, ctx: PptxContext): string | undefined {
  if (!typeface) return undefined;
  if (typeface.startsWith('+mj')) return ctx.theme.majorFont;
  if (typeface.startsWith('+mn')) return ctx.theme.minorFont;
  return typeface;
}

interface SlideRunStyle {
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  font?: string;
  baseline?: number;
  caps?: boolean;
  highlight?: string;
}

function slideRunStyle(rPrs: Array<Element | null>, ctx: PptxContext, fontRefColor?: string, fontRefIndex = 3): SlideRunStyle {
  const out: SlideRunStyle = {};
  const first = <T>(fn: (e: Element) => T | undefined): T | undefined => {
    for (const e of rPrs) {
      if (!e) continue;
      const v = fn(e);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  out.sizePt = first((e) => {
    const v = numAttr(e, 'sz');
    return v ? v / 100 : undefined;
  });
  const flag = (name: string) => first((e) => {
    const v = attr(e, name);
    return v === null ? undefined : v === '1' || v === 'true';
  });
  out.bold = flag('b');
  out.italic = flag('i');
  out.underline = first((e) => {
    const v = attr(e, 'u');
    return v === null ? undefined : v !== 'none';
  });
  out.strike = first((e) => {
    const v = attr(e, 'strike');
    return v === null ? undefined : v !== 'noStrike';
  });
  out.baseline = first((e) => numAttr(e, 'baseline'));
  out.caps = first((e) => {
    const v = attr(e, 'cap');
    return v === null ? undefined : v === 'all';
  });
  out.font = first((e) => slideFont(attr(child(e, 'latin'), 'typeface'), ctx));
  out.highlight = first((e) => resolveColor(child(e, 'highlight'), ctx.theme, ctx.clrMap));
  // Colour: the first `fontRefIndex` sources (run, paragraph, shape list style) win over the shape's
  // style colour; the inherited layout/master styles come after it.
  let color: string | undefined;
  for (let i = 0; i < rPrs.length && color === undefined; i += 1) {
    if (i === fontRefIndex && fontRefColor) {
      color = fontRefColor;
      break;
    }
    const e = rPrs[i];
    if (!e) continue;
    if (child(e, 'noFill')) color = 'transparent';
    else color = resolveColor(child(e, 'solidFill'), ctx.theme, ctx.clrMap) ?? resolveColor(child(e, 'gradFill') ? firstDescendant(child(e, 'gradFill'), 'gs') : null, ctx.theme, ctx.clrMap);
  }
  out.color = color ?? fontRefColor;
  return out;
}

function slideRunCss(s: SlideRunStyle, ctx: PptxContext, fontScale: number): string {
  const css: string[] = [];
  const size = (s.sizePt ?? 18) * fontScale;
  css.push(`font-size:${ptToCqw(s.baseline ? size * 0.7 : size, ctx)}`);
  if (s.bold) css.push('font-weight:700');
  if (s.italic) css.push('font-style:italic');
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
  if (s.color) css.push(`color:${s.color}`);
  const font = fontStack(s.font);
  if (font) css.push(`font-family:${font}`);
  if (s.baseline) css.push(`vertical-align:${s.baseline > 0 ? 'super' : 'sub'}`);
  if (s.caps) css.push('text-transform:uppercase');
  if (s.highlight) css.push(`background-color:${s.highlight}`);
  return css.join(';');
}

function autoNumber(scheme: string, n: number): string {
  const m = /^(arabic|romanUc|romanLc|alphaUc|alphaLc|circleNumDbPlain|circleNumWdBlackPlain)(.*)$/.exec(scheme);
  const kind = m?.[1] ?? 'arabic';
  const suffix = m?.[2] ?? 'Period';
  const value =
    kind === 'romanUc' ? toRoman(n) : kind === 'romanLc' ? toRoman(n).toLowerCase() : kind === 'alphaUc' ? toLetters(n) : kind === 'alphaLc' ? toLetters(n).toLowerCase() : String(n);
  if (suffix === 'ParenR') return `${value})`;
  if (suffix === 'ParenBoth') return `(${value})`;
  if (suffix === 'Plain') return value;
  if (suffix === 'Minus') return `${value}-`;
  return `${value}.`;
}

function renderTextBody(
  txBody: Element | null,
  sources: TextSources,
  ctx: PptxContext,
): { html: string; bodyCss: string } {
  if (!txBody) return { html: '', bodyCss: '' };
  const bodyPrs = sources.bodyPrs;
  const bodyAttr = (name: string) => {
    for (const b of bodyPrs) {
      const v = attr(b, name);
      if (v !== null) return v;
    }
    return null;
  };
  const autofit = firstDescendant(child(txBody, 'bodyPr'), 'normAutofit');
  const fontScale = (numAttr(autofit, 'fontScale') ?? 100000) / 100000;
  const lnReduction = (numAttr(autofit, 'lnSpcReduction') ?? 0) / 100000;
  const fontRefColor = resolveColor(sources.fontRef, ctx.theme, ctx.clrMap);

  const counters: number[] = [];
  const paragraphs = children(txBody, 'p').map((p) => {
    const pPr = child(p, 'pPr');
    const lvl = numAttr(pPr, 'lvl') ?? 0;
    const levels = [pPr, ...levelProps(sources.lists, lvl)].filter((e): e is Element => Boolean(e));
    const pick = (name: string) => {
      for (const l of levels) {
        const v = attr(l, name);
        if (v !== null) return v;
      }
      return null;
    };
    const pickChild = (name: string) => {
      for (const l of levels) {
        const c = child(l, name);
        if (c) return c;
      }
      return null;
    };
    const defRPrs = levels.map((l) => child(l, 'defRPr'));
    // pPr (direct) and the shape's own list style come before the shape style colour.
    const directCount = (pPr ? 1 : 0) + (levelProps([sources.lists[0]], lvl).length);

    const align = pick('algn');
    const marL = Number(pick('marL') ?? 0);
    const indent = Number(pick('indent') ?? 0);
    const css: string[] = ['margin:0'];
    const textAlign = align === 'ctr' ? 'center' : align === 'r' ? 'right' : align === 'just' || align === 'dist' ? 'justify' : 'left';
    css.push(`text-align:${textAlign}`);
    if (marL) css.push(`padding-left:${cqw(marL, ctx)}`);
    if (indent) css.push(`text-indent:${cqw(indent, ctx)}`);
    const spacing = (name: string): string | undefined => {
      const el = pickChild(name);
      const pts = numAttr(child(el, 'spcPts'), 'val');
      if (pts !== undefined) return ptToCqw((pts / 100) * fontScale, ctx);
      const pctVal = numAttr(child(el, 'spcPct'), 'val');
      if (pctVal !== undefined) return `${fmt((pctVal / 100000) * 1.2, 3)}em`;
      return undefined;
    };
    const before = spacing('spcBef');
    const after = spacing('spcAft');
    if (before) css.push(`margin-top:${before}`);
    if (after) css.push(`margin-bottom:${after}`);
    const lnSpc = pickChild('lnSpc');
    const lnPct = numAttr(child(lnSpc, 'spcPct'), 'val');
    const lnPts = numAttr(child(lnSpc, 'spcPts'), 'val');
    if (lnPts !== undefined) css.push(`line-height:${ptToCqw((lnPts / 100) * fontScale, ctx)}`);
    else css.push(`line-height:${fmt(Math.max(0.6, ((lnPct ?? 100000) / 100000 - lnReduction) * 1.2), 3)}`);

    const endStyle = slideRunStyle([child(p, 'endParaRPr'), ...defRPrs], ctx, fontRefColor, directCount + 1);
    let runsHtml = '';
    let hasText = false;
    let firstRunStyle: SlideRunStyle | null = null;
    for (const r of kids(p)) {
      if (r.localName === 'r' || r.localName === 'fld') {
        const rStyle = slideRunStyle([child(r, 'rPr'), ...defRPrs], ctx, fontRefColor, directCount + 1);
        firstRunStyle = firstRunStyle ?? rStyle;
        let text = child(r, 't')?.textContent ?? '';
        if (r.localName === 'fld' && attr(r, 'type') === 'slidenum') text = String(ctx.slideNumber);
        if (text) hasText = true;
        runsHtml += `<span style="${slideRunCss(rStyle, ctx, fontScale)}">${esc(text)}</span>`;
      } else if (r.localName === 'br') {
        runsHtml += '<br />';
      }
    }

    // Bullets
    let bullet = '';
    if (hasText && !pickChild('buNone')) {
      const buChar = pickChild('buChar');
      const buAuto = pickChild('buAutoNum');
      const levelBullet = levels.find((l) => child(l, 'buNone') || child(l, 'buChar') || child(l, 'buAutoNum') || child(l, 'buBlip'));
      const effective = levelBullet && !child(levelBullet, 'buNone') ? levelBullet : null;
      let text = '';
      if (effective && child(effective, 'buChar') && buChar) {
        text = normalizeBulletChar(attr(buChar, 'char') ?? '•', attr(pickChild('buFont'), 'typeface'));
        counters.length = 0;
      } else if (effective && child(effective, 'buAutoNum') && buAuto) {
        for (let l = lvl + 1; l < counters.length; l += 1) counters[l] = 0;
        counters[lvl] = (counters[lvl] || (numAttr(buAuto, 'startAt') ?? 1) - 1) + 1;
        text = autoNumber(attr(buAuto, 'type') ?? 'arabicPeriod', counters[lvl]);
      } else if (effective && child(effective, 'buBlip')) {
        text = '•';
      }
      if (text) {
        const base = firstRunStyle ?? endStyle;
        const buColor = resolveColor(pickChild('buClr'), ctx.theme, ctx.clrMap);
        const buSize = numAttr(child(pickChild('buSzPct'), 'val') ? pickChild('buSzPct') : null, 'val');
        const bStyle: SlideRunStyle = {
          ...base,
          underline: false,
          strike: false,
          color: buColor ?? base.color,
          sizePt: (base.sizePt ?? 18) * (buSize ? buSize / 100000 : 1),
          font: attr(pickChild('buFont'), 'typeface') && !/wingdings|symbol/i.test(attr(pickChild('buFont'), 'typeface') ?? '') ? slideFont(attr(pickChild('buFont'), 'typeface'), ctx) : base.font,
        };
        const hang = indent < 0 ? `display:inline-block;min-width:${cqw(-indent, ctx)};text-indent:0;` : '';
        bullet = `<span style="${hang}${slideRunCss(bStyle, ctx, fontScale)}">${esc(text)}${hang ? '' : ' '}</span>`;
      }
    }

    if (!hasText) {
      runsHtml = `<span style="${slideRunCss(endStyle, ctx, fontScale)}">&#8203;</span>`;
    }
    return `<p style="${css.join(';')}">${bullet}${runsHtml}</p>`;
  });

  const anchor = bodyAttr('anchor') ?? 't';
  const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  const inset = (name: string, def: number) => {
    const v = bodyAttr(name);
    return cqw(v !== null && Number.isFinite(Number(v)) ? Number(v) : def, ctx);
  };
  const wrapNone = bodyAttr('wrap') === 'none';
  const vert = bodyAttr('vert');
  const bodyCss = [
    'display:flex',
    'flex-direction:column',
    `justify-content:${justify}`,
    `padding:${inset('tIns', 45720)} ${inset('rIns', 91440)} ${inset('bIns', 45720)} ${inset('lIns', 91440)}`,
    wrapNone ? 'white-space:pre' : 'white-space:pre-wrap',
    vert === 'vert' || vert === 'eaVert' ? 'writing-mode:vertical-rl' : vert === 'vert270' ? 'writing-mode:vertical-rl;transform:rotate(180deg)' : '',
  ]
    .filter(Boolean)
    .join(';');
  return { html: paragraphs.join(''), bodyCss };
}

function renderPptxShape(shape: Element, ctx: PptxContext, part: SlidePart, layer: 'slide' | 'layout' | 'master', tf: Transform): string {
  const cNvPr = firstDescendant(kids(shape).find((k) => k.localName.startsWith('nv')) ?? null, 'cNvPr');
  if (attr(cNvPr, 'hidden') === '1') return '';
  const ph = placeholderOf(shape);
  const spPr = child(shape, 'spPr');
  let xf = readXfrm(child(spPr, 'xfrm'));
  if (!xf && ph) {
    const fromLayout = layer === 'slide' ? findPlaceholder(ctx.layout, ph, true) : null;
    const fromMaster = findPlaceholder(ctx.master, ph, false);
    xf = readXfrm(path(fromLayout, 'spPr', 'xfrm')) ?? readXfrm(path(fromMaster, 'spPr', 'xfrm'));
  }
  if (!xf) return '';
  const [x, y, w, h] = tf(xf.x, xf.y, xf.w, xf.h);

  const style = child(shape, 'style');
  const css: string[] = [
    `left:${pct(x, ctx.cx)}`,
    `top:${pct(y, ctx.cy)}`,
    `width:${pct(w, ctx.cx)}`,
    `height:${pct(h, ctx.cy)}`,
  ];
  const fill = spPr ? fillCss(spPr, ctx, part, child(style, 'fillRef')) : undefined;
  if (fill) css.push(fill);
  const outline = outlineCss(spPr, ctx, child(style, 'lnRef'));
  if (outline) css.push(outline);
  const geom = geometryCss(spPr);
  if (geom) css.push(geom);
  const tr = transformCss(xf.rot, xf.flipH, xf.flipV);
  if (tr) css.push(tr);

  const sources = textSourcesFor(shape, ctx, layer);
  const text = renderTextBody(child(shape, 'txBody'), sources, ctx);
  // Text isn't mirrored by flips.
  const textFlip = xf.flipH || xf.flipV ? `transform:${xf.flipH ? 'scaleX(-1)' : ''} ${xf.flipV ? 'scaleY(-1)' : ''};` : '';
  const inner = text.html ? `<div class="pv-text" style="${textFlip}${text.bodyCss}">${text.html}</div>` : '';
  if (!inner && !fill && !outline) return '';
  return `<div class="pv-shape" style="${css.join(';')}">${inner}</div>`;
}

function renderPptxPicture(pic: Element, ctx: PptxContext, part: SlidePart, layer: 'slide' | 'layout' | 'master', tf: Transform): string {
  const spPr = child(pic, 'spPr');
  let xf = readXfrm(child(spPr, 'xfrm'));
  const ph = placeholderOf(pic);
  if (!xf && ph) {
    const fromLayout = layer === 'slide' ? findPlaceholder(ctx.layout, ph, true) : null;
    xf = readXfrm(path(fromLayout, 'spPr', 'xfrm')) ?? readXfrm(path(findPlaceholder(ctx.master, ph, false), 'spPr', 'xfrm'));
  }
  if (!xf) return '';
  const blipFill = child(pic, 'blipFill');
  const id = attr(child(blipFill, 'blip'), 'embed');
  const src = id ? part.images.get(id) : undefined;
  if (!src) return '';
  const [x, y, w, h] = tf(xf.x, xf.y, xf.w, xf.h);
  const css = [`left:${pct(x, ctx.cx)}`, `top:${pct(y, ctx.cy)}`, `width:${pct(w, ctx.cx)}`, `height:${pct(h, ctx.cy)}`, 'overflow:hidden'];
  const geom = geometryCss(spPr);
  if (geom) css.push(geom);
  const outline = outlineCss(spPr, ctx);
  const tr = transformCss(xf.rot, xf.flipH, xf.flipV);
  if (tr) css.push(tr);

  // Cropping (a:srcRect l/t/r/b in 1/1000 %)
  const src2 = child(blipFill, 'srcRect');
  const l = (numAttr(src2, 'l') ?? 0) / 100000;
  const t = (numAttr(src2, 't') ?? 0) / 100000;
  const r = (numAttr(src2, 'r') ?? 0) / 100000;
  const b = (numAttr(src2, 'b') ?? 0) / 100000;
  const visW = Math.max(0.01, 1 - l - r);
  const visH = Math.max(0.01, 1 - t - b);
  const imgCss = `position:absolute;max-width:none;left:${fmt((-l / visW) * 100, 4)}%;top:${fmt((-t / visH) * 100, 4)}%;width:${fmt((1 / visW) * 100, 4)}%;height:${fmt((1 / visH) * 100, 4)}%`;
  const border = outline ? `<div style="position:absolute;inset:0;${outline};${geom}"></div>` : '';
  return `<div class="pv-shape" style="${css.join(';')}"><img src="${src}" alt="" draggable="false" style="${imgCss}" />${border}</div>`;
}

function renderPptxTable(frame: Element, tbl: Element, ctx: PptxContext, tf: Transform): string {
  const xf = readXfrm(child(frame, 'xfrm'));
  if (!xf) return '';
  const [x, y, w] = tf(xf.x, xf.y, xf.w, xf.h);
  const tblPr = child(tbl, 'tblPr');
  const firstRow = attr(tblPr, 'firstRow') === '1';
  const bandRow = attr(tblPr, 'bandRow') === '1';
  const hasStyle = Boolean(firstDescendant(tblPr, 'tableStyleId'));
  const accent = ctx.theme.colors.accent1 ?? '4472C4';
  const tint = (amount: number) => applyColorMods(accent, parseXml(`<c><tint val="${amount}"/></c>`)!.documentElement);
  const grid = children(child(tbl, 'tblGrid'), 'gridCol').map((g) => numAttr(g, 'w') ?? 0);
  const totalW = grid.reduce((a, b) => a + b, 0) || w;
  const otherStyle = child(path(ctx.master?.doc.documentElement, 'txStyles'), 'otherStyle');

  const rowsHtml = children(tbl, 'tr').map((tr, rowIndex) => {
    const hEmu = numAttr(tr, 'h') ?? 0;
    const isHeader = firstRow && rowIndex === 0;
    const cells = children(tr, 'tc').map((tc) => {
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') return '';
      const tcPr = child(tc, 'tcPr');
      const css: string[] = ['border:1px solid rgba(255,255,255,.9)', 'vertical-align:top'];
      const fill = tcPr ? fillCss(tcPr, ctx, ctx.slide) : undefined;
      if (fill) css.push(fill);
      else if (hasStyle) {
        if (isHeader) css.push(`background:#${accent}`);
        else if (bandRow) css.push(`background:${(firstRow ? rowIndex - 1 : rowIndex) % 2 === 0 ? tint(40000) : tint(20000)}`);
      }
      const anchor = attr(tcPr, 'anchor');
      if (anchor === 'ctr') css[1] = 'vertical-align:middle';
      else if (anchor === 'b') css[1] = 'vertical-align:bottom';
      const pad = (name: string, def: number) => cqw(numAttr(tcPr, name) ?? def, ctx);
      css.push(`padding:${pad('marT', 45720)} ${pad('marR', 91440)} ${pad('marB', 45720)} ${pad('marL', 91440)}`);
      const sources: TextSources = { lists: [child(child(tc, 'txBody'), 'lstStyle'), otherStyle, ctx.defaultTextStyle], bodyPrs: [], fontRef: null };
      const headerColor = isHeader && hasStyle && !fill ? 'color:#FFFFFF;font-weight:700;' : '';
      const body = renderTextBody(child(tc, 'txBody'), sources, ctx);
      const span = `${(numAttr(tc, 'gridSpan') ?? 1) > 1 ? ` colspan="${attr(tc, 'gridSpan')}"` : ''}${(numAttr(tc, 'rowSpan') ?? 1) > 1 ? ` rowspan="${attr(tc, 'rowSpan')}"` : ''}`;
      return `<td${span} style="${css.join(';')}"><div style="${headerColor}white-space:pre-wrap">${body.html}</div></td>`;
    });
    return `<tr style="height:${pct(hEmu, ctx.cy)}">${cells.join('')}</tr>`;
  });
  const cols = grid.map((g) => `<col style="width:${fmt((g / totalW) * 100, 3)}%" />`).join('');
  return `<div class="pv-shape" style="left:${pct(x, ctx.cx)};top:${pct(y, ctx.cy)};width:${pct(w, ctx.cx)}"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><colgroup>${cols}</colgroup><tbody>${rowsHtml.join('')}</tbody></table></div>`;
}

async function renderPptxGraphicFrame(frame: Element, ctx: PptxContext, part: SlidePart, tf: Transform): Promise<string> {
  const tbl = firstDescendant(frame, 'tbl');
  if (tbl) return renderPptxTable(frame, tbl, ctx, tf);
  const xf = readXfrm(child(frame, 'xfrm'));
  if (!xf) return '';
  const [x, y, w, h] = tf(xf.x, xf.y, xf.w, xf.h);

  // SmartArt: render the pre-drawn shapes PowerPoint stores with the diagram.
  const relIds = firstDescendant(frame, 'relIds');
  if (relIds) {
    const rels = await ctx.pkg.rels(part.path);
    const dataRel = rels.get(attr(relIds, 'dm') ?? '');
    let drawingPath: string | null = null;
    if (dataRel) {
      const dataDoc = await ctx.pkg.xml(dataRel.target);
      const drawingRelId = attr(firstDescendant(dataDoc, 'dataModelExt'), 'relId');
      if (drawingRelId) drawingPath = rels.get(drawingRelId)?.target ?? null;
    }
    if (!drawingPath) {
      for (const rel of rels.values()) {
        if (rel.type.endsWith('/diagramDrawing')) {
          drawingPath = rel.target;
          break;
        }
      }
    }
    if (drawingPath) {
      const drawingDoc = await ctx.pkg.xml(drawingPath);
      const spTree = firstDescendant(drawingDoc, 'spTree');
      if (drawingDoc && spTree) {
        const drawingPart: SlidePart = { path: drawingPath, doc: drawingDoc, images: await ctx.pkg.imagesForPart(drawingPath, drawingDoc) };
        const offsetTf: Transform = (cx, cy, cw, ch) => tf(xf.x + cx, xf.y + cy, cw, ch);
        return await renderPptxTree(spTree, ctx, drawingPart, 'slide', offsetTf, true);
      }
    }
  }

  // OLE objects / others with a fallback picture
  const pic = firstDescendant(frame, 'pic');
  if (pic) {
    const id = attr(firstDescendant(pic, 'blip'), 'embed');
    const src = id ? part.images.get(id) : undefined;
    if (src) {
      return `<div class="pv-shape" style="left:${pct(x, ctx.cx)};top:${pct(y, ctx.cy)};width:${pct(w, ctx.cx)};height:${pct(h, ctx.cy)}"><img src="${src}" alt="" draggable="false" style="width:100%;height:100%;max-width:none;object-fit:fill" /></div>`;
    }
  }
  const isChart = Boolean(firstDescendant(frame, 'chart'));
  return `<div class="pv-shape" style="left:${pct(x, ctx.cx)};top:${pct(y, ctx.cy)};width:${pct(w, ctx.cx)};height:${pct(h, ctx.cy)};display:flex;align-items:center;justify-content:center;border:1px dashed #cbd5e1;color:#94a3b8;font-size:${ptToCqw(12, ctx)}">${isChart ? 'Chart' : 'Embedded object'}</div>`;
}

async function renderPptxTree(
  tree: Element,
  ctx: PptxContext,
  part: SlidePart,
  layer: 'slide' | 'layout' | 'master',
  tf: Transform,
  includePlaceholders = layer === 'slide',
): Promise<string> {
  let html = '';
  for (const el of kids(tree)) {
    const name = el.localName;
    if ((name === 'sp' || name === 'pic') && !includePlaceholders && placeholderOf(el)) continue;
    if (name === 'sp') html += renderPptxShape(el, ctx, part, layer, tf);
    else if (name === 'pic') html += renderPptxPicture(el, ctx, part, layer, tf);
    else if (name === 'cxnSp') html += renderPptxConnector(el, ctx, tf);
    else if (name === 'graphicFrame') html += await renderPptxGraphicFrame(el, ctx, part, tf);
    else if (name === 'grpSp') {
      const xfrm = path(el, 'grpSpPr', 'xfrm');
      const off = child(xfrm, 'off');
      const ext = child(xfrm, 'ext');
      const chOff = child(xfrm, 'chOff');
      const chExt = child(xfrm, 'chExt');
      let groupTf = tf;
      if (off && ext && chOff && chExt) {
        const sx = (numAttr(ext, 'cx') ?? 1) / (numAttr(chExt, 'cx') || 1);
        const sy = (numAttr(ext, 'cy') ?? 1) / (numAttr(chExt, 'cy') || 1);
        const ox = numAttr(off, 'x') ?? 0;
        const oy = numAttr(off, 'y') ?? 0;
        const cox = numAttr(chOff, 'x') ?? 0;
        const coy = numAttr(chOff, 'y') ?? 0;
        groupTf = (cx, cy, cw, ch) => tf(ox + (cx - cox) * sx, oy + (cy - coy) * sy, cw * sx, ch * sy);
      }
      html += await renderPptxTree(el, ctx, part, layer, groupTf, includePlaceholders);
    } else if (name === 'AlternateContent') {
      const branch = child(el, 'Fallback') ?? child(el, 'Choice');
      if (branch) html += await renderPptxTree(branch, ctx, part, layer, tf, includePlaceholders);
    }
  }
  return html;
}

function renderPptxConnector(cxn: Element, ctx: PptxContext, tf: Transform): string {
  const spPr = child(cxn, 'spPr');
  const xf = readXfrm(child(spPr, 'xfrm'));
  if (!xf) return '';
  const [x, y, w, h] = tf(xf.x, xf.y, xf.w, xf.h);
  const ln = child(spPr, 'ln');
  const color = resolveColor(child(ln, 'solidFill'), ctx.theme, ctx.clrMap) ?? resolveColor(path(cxn, 'style', 'lnRef'), ctx.theme, ctx.clrMap) ?? '#000000';
  const widthPx = Math.max(1, (numAttr(ln, 'w') ?? 12700) / 9525);
  const x1 = xf.flipH ? 100 : 0;
  const x2 = xf.flipH ? 0 : 100;
  const y1 = xf.flipV ? 100 : 0;
  const y2 = xf.flipV ? 0 : 100;
  const tr = xf.rot ? `transform:rotate(${fmt(xf.rot)}deg);` : '';
  return `<svg class="pv-shape" viewBox="0 0 100 100" preserveAspectRatio="none" style="left:${pct(x, ctx.cx)};top:${pct(y, ctx.cy)};width:${pct(Math.max(w, 1), ctx.cx)};height:${pct(Math.max(h, 1), ctx.cy)};overflow:visible;${tr}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${fmt(widthPx)}" vector-effect="non-scaling-stroke" /></svg>`;
}

async function loadSlidePart(pkg: OfficePackage, partPath: string | null): Promise<SlidePart | null> {
  if (!partPath) return null;
  const doc = await pkg.xml(partPath);
  if (!doc) return null;
  return { path: partPath, doc, images: await pkg.imagesForPart(partPath, doc) };
}

export async function buildRichPptxPreview(fileBytes: Uint8Array, fileName: string): Promise<RichPreviewResult | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const pkg = new OfficePackage(zip);
  const presPath = 'ppt/presentation.xml';
  const pres = await pkg.xml(presPath);
  if (!pres) return null;
  const sldSz = firstDescendant(pres, 'sldSz');
  const cx = numAttr(sldSz, 'cx') ?? 9144000;
  const cy = numAttr(sldSz, 'cy') ?? 6858000;
  const defaultTextStyle = firstDescendant(pres, 'defaultTextStyle');

  // Slide order from the presentation's slide list.
  const presRels = await pkg.rels(presPath);
  let slidePaths = descendants(pres, 'sldId')
    .map((s) => presRels.get(attr(s, 'id') ?? '')?.target)
    .filter((p): p is string => Boolean(p));
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  }
  if (slidePaths.length === 0) return null;

  const themeCache = new Map<string, Theme>();
  const slidesHtml: string[] = [];
  for (let i = 0; i < Math.min(slidePaths.length, 300); i += 1) {
    const slide = await loadSlidePart(pkg, slidePaths[i]);
    if (!slide) continue;
    const layout = await loadSlidePart(pkg, await pkg.relTargetByType(slide.path, '/slideLayout'));
    const master = layout ? await loadSlidePart(pkg, await pkg.relTargetByType(layout.path, '/slideMaster')) : null;
    const themePath = master ? await pkg.relTargetByType(master.path, '/theme') : null;
    let theme = themePath ? themeCache.get(themePath) : undefined;
    if (!theme) {
      theme = parseTheme(themePath ? await pkg.xml(themePath) : null);
      if (themePath) themeCache.set(themePath, theme);
    }
    const clrMapEl = master ? child(master.doc.documentElement, 'clrMap') : null;
    const clrMap: Record<string, string> = { ...DEFAULT_CLR_MAP };
    for (const a of Array.from(clrMapEl?.attributes ?? [])) clrMap[a.localName] = a.value;
    const override = firstDescendant(path(slide.doc.documentElement, 'clrMapOvr'), 'overrideClrMapping');
    for (const a of Array.from(override?.attributes ?? [])) clrMap[a.localName] = a.value;

    const ctx: PptxContext = { pkg, theme, clrMap, cx, cy, slide, layout, master, defaultTextStyle, slideNumber: i + 1 };
    const bg = backgroundCss(slide, ctx) ?? backgroundCss(layout, ctx) ?? backgroundCss(master, ctx) ?? 'background:#FFFFFF';

    let shapes = '';
    const showMasterShapes = attr(slide.doc.documentElement, 'showMasterSp') !== '0';
    if (showMasterShapes && master && attr(layout?.doc.documentElement, 'showMasterSp') !== '0') {
      const tree = firstDescendant(master.doc, 'spTree');
      if (tree) shapes += await renderPptxTree(tree, ctx, master, 'master', identity, false);
    }
    if (showMasterShapes && layout) {
      const tree = firstDescendant(layout.doc, 'spTree');
      if (tree) shapes += await renderPptxTree(tree, ctx, layout, 'layout', identity, false);
    }
    const slideTree = firstDescendant(slide.doc, 'spTree');
    if (slideTree) shapes += await renderPptxTree(slideTree, ctx, slide, 'slide', identity, true);

    const hidden = attr(slide.doc.documentElement, 'show') === '0';
    const minorFont = fontStack(theme.minorFont) ?? "'Calibri', sans-serif";
    slidesHtml.push(
      `<section class="pv-slide"><div class="pv-label">Slide ${i + 1}${hidden ? ' (hidden)' : ''}</div>` +
        `<div class="pv-canvas" style="aspect-ratio:${cx} / ${cy};${bg};font-family:${minorFont}">${shapes}</div></section>`
    );
  }

  const styleBlock = `<style>
    .pv-deck{background:#e2e8f0;padding:16px 12px;border-radius:8px;}
    .pv-deck .pv-slide{max-width:1000px;margin:0 auto 18px;}
    .pv-deck .pv-slide:last-child{margin-bottom:0}
    .pv-deck .pv-label{font:600 12px/1.4 "Segoe UI",sans-serif;color:#475569;margin:0 0 6px 2px;}
    .pv-deck .pv-canvas{position:relative;width:100%;overflow:hidden;container-type:inline-size;box-shadow:0 1px 4px rgba(15,23,42,.2);color:#000;line-height:1.2;}
    .pv-deck .pv-shape{position:absolute;box-sizing:border-box;}
    .pv-deck .pv-text{position:absolute;inset:0;box-sizing:border-box;overflow:visible;word-wrap:break-word;}
    .pv-deck p{margin:0}
    .pv-deck td{box-sizing:border-box;}
  </style>`;
  return { kind: 'html', title: fileName, html: `${styleBlock}<div class="pv-deck">${slidesHtml.join('')}</div>` };
}
