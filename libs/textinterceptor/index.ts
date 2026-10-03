// Port of keiyoushi/extensions-source lib/textinterceptor/TextInterceptor.kt
//
// Upstream draws the text onto an Android Bitmap with StaticLayout and returns a PNG. There is no canvas here, so the
// page is an SVG laid out with the same designer values; lines wrap on an approximate glyph-width measure. Every
// piece of text is XML-escaped and the SVG carries no scripts, links or external references (the app serves it from
// its own origin).
import { Response, type ChainInterceptor } from "../../sdk/network.ts";

// Designer values:
const WIDTH = 1000;
const X_PADDING = 50;
const Y_PADDING = 25;
const HEADING_FONT_SIZE = 36;
const BODY_FONT_SIZE = 30;
const SPACING_MULT = 1.1;
const SPACING_ADD = 2;

export const TextInterceptorHelper = {
  HOST: "tachiyomi-lib-textinterceptor",
  /** Uri.encode and encodeURIComponent leave the same characters alone (letters, digits, -_.!~*'()). */
  createUrl(title: string, text: string): string {
    return `http://${TextInterceptorHelper.HOST}/` + encodeURIComponent(title) + "/" + encodeURIComponent(text);
  },
};

// No need to touch this one:
const HOST = TextInterceptorHelper.HOST;

/** `addInterceptor(TextInterceptor())` upstream is `addChainInterceptor(TextInterceptor())` here. */
export function TextInterceptor(): ChainInterceptor {
  return async (chain) => {
    const request = chain.request();
    const url = new URL(request.url);
    if (url.hostname !== HOST) return chain.proceed(request);

    const pathSegments = url.pathname.split("/").slice(1).map((s) => decodeURIComponent(s));
    const heading = pathSegments[0] ? layout(textFixer(pathSegments[0]), HEADING_FONT_SIZE, true) : null;
    const body = pathSegments[1] ? layout(textFixer(pathSegments[1]), BODY_FONT_SIZE, false) : null;

    // Image building
    const headingHeight = heading?.height ?? 0;
    const bodyHeight = body?.height ?? 0;
    const imgHeight = Math.trunc(headingHeight + bodyHeight + 2 * Y_PADDING);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${imgHeight}" viewBox="0 0 ${WIDTH} ${imgHeight}">` +
      `<rect width="${WIDTH}" height="${imgHeight}" fill="#fff"/>` +
      (heading?.draw(X_PADDING, Y_PADDING) ?? "") +
      (body?.draw(X_PADDING, Y_PADDING + headingHeight) ?? "") +
      `</svg>`;
    return Response.of(request.url, new TextEncoder().encode(svg), "image/svg+xml");
  };
}

/** Html.fromHtml(s, FROM_HTML_MODE_LEGACY).toString(): whitespace collapses, <br> and block tags break lines, tags go, entities decode. */
function textFixer(htmlString: string): string {
  return htmlString
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|h[1-6]|blockquote|ul|ol|li)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[k] ?? m;
    })
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)
    // characters XML 1.0 forbids (control codes, lone surrogates) would make the image unparseable
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");

/** Glyph advance in ems for a generic sans-serif; ponytail: estimate, a real font metric table if wrapping looks off. */
function charWidth(c: string): number {
  const cp = c.codePointAt(0)!;
  if (cp >= 0x2e80) return 1; // CJK, kana, hangul, fullwidth
  if (" .,:;'|!il ".includes(c)) return 0.28;
  if ("fjrtI()[]\"-".includes(c)) return 0.36;
  if ("mwMW@".includes(c)) return 0.85;
  if (c >= "A" && c <= "Z") return 0.66;
  return 0.54;
}

/** StaticLayout(text, paint, WIDTH - 2 * X_PADDING, ALIGN_NORMAL, SPACING_MULT, SPACING_ADD, includePad = true) */
function layout(text: string, fontSize: number, bold: boolean) {
  const maxWidth = WIDTH - 2 * X_PADDING;
  const em = fontSize * (bold ? 1.06 : 1);
  const measure = (s: string) => [...s].reduce((w, c) => w + charWidth(c) * em, 0);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    // words keep their trailing space, as StaticLayout breaks after spaces; an over-long word breaks mid-word
    for (const word of paragraph.match(/\S+\s*|\s+/g) ?? [""]) {
      if (measure(line + word.trimEnd()) <= maxWidth) {
        line += word;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = "";
      for (const c of word) {
        if (line && measure(line + c) > maxWidth) (lines.push(line), (line = ""));
        line += c;
      }
    }
    lines.push(line.trimEnd());
  }
  // Roboto's line height (ascent + descent, padded) is ~1.17em
  const lineHeight = fontSize * 1.17 * SPACING_MULT + SPACING_ADD;
  return {
    height: Math.round(lines.length * lineHeight),
    draw: (x: number, y: number) =>
      `<text font-family="sans-serif" font-size="${fontSize}"${bold ? ' font-weight="bold"' : ""} fill="#000" xml:space="preserve">` +
      lines.map((l, i) => `<tspan x="${x}" y="${(y + i * lineHeight + fontSize * 0.95).toFixed(1)}">${escapeXml(l)}</tspan>`).join("") +
      `</text>`,
  };
}
