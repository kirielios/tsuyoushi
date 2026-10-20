// Port of aniyomi lib/vidguardextractor. The master playlist is returned as one video: the player (hls.js) reads its
// variants and switches quality itself, so PlaylistUtils' per-variant split is not needed.
//
// Upstream runs the page's `eval(...)` script in Rhino and reads `window.svg`. Running a site's script here would run
// it with the app's privileges, so the script (AAEncode, `ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻ ...`) is decoded as text instead.
import { Video } from "../../sdk/anime.ts";
import { Base64, hexBytes } from "../../sdk/crypto.ts";
import type { HttpClient } from "../../sdk/network.ts";

interface SvgObject {
  stream: string;
  hash: string;
}

export class VidGuardExtractor {
  constructor(private readonly client: HttpClient) {}

  /** videosFromUrl(url, prefix) upstream is the `string` overload of the second argument. */
  async videosFromUrl(url: string, videoNameGen: string | ((quality: string) => string) = (quality) => `VidGuard:${quality}`): Promise<Video[]> {
    const nameGen = typeof videoNameGen === "string" ? (q: string) => `${videoNameGen}VidGuard:${q}` : videoNameGen;
    try {
      const res = (await this.client.get(url)).asJsoup();
      const scriptData = res.selectFirst("script:containsData(eval)")?.data();
      if (!scriptData) return [];

      const jsonStr2 = JSON.parse(runJS2(scriptData)) as SvgObject;
      const playlistUrl = sigDecode(jsonStr2.stream);

      return [new Video({ videoUrl: playlistUrl, videoTitle: nameGen("Auto") })];
    } catch {
      return [];
    }
  }
}

function sigDecode(url: string): string {
  const sig = url.split("sig=")[1].split("&")[0];
  let t = Array.from(hexBytes(sig), (b) => String.fromCharCode(b ^ 2)).join("");
  t = t + (t.length % 4 === 2 ? "==" : t.length % 4 === 3 ? "=" : "");
  const chars = [...latin1(Base64.decode(t)).slice(0, -5)].reverse();
  for (let i = 0; i + 1 < chars.length; i += 2) [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
  return url.replace(sig, chars.join("").slice(0, -5));
}

const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join("");

/** Returns `window.svg` as JSON, from the decoded script. */
function runJS2(hideMyHtmlContent: string): string {
  let script = hideMyHtmlContent;
  // eval("window.ADBLOCKER = false;\n<aaencode>;"): the argument is a JS string literal
  const lit = /eval\(\s*"((?:[^"\\]|\\.)*)"\s*\)/s.exec(script);
  if (lit) script = unescapeJs(lit[1]);
  if (script.includes("ﾟωﾟﾉ")) script = aadecode(script.slice(script.indexOf("ﾟωﾟﾉ")));
  const at = script.search(/svg\s*=\s*\{/);
  if (at < 0) throw new Error("VidGuard: window.svg not found");
  const start = script.indexOf("{", at);
  // ponytail: assumes `svg` is a JSON object literal; a JS-only literal (unquoted keys, functions) is not handled
  return script.slice(start, script.lastIndexOf("}") + 1);
}

function unescapeJs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[e] ?? e;
  });
}

// aaencode's digit expressions (after (ﾟｰﾟ)+=(ﾟΘﾟ), so ﾟｰﾟ is 4), whitespace removed, longest first so that compound
// expressions are replaced before their parts.
const AA_DIGITS: [string, string][] = (
  [
    ["(c^_^o)", "0"],
    ["(ﾟΘﾟ)", "1"],
    ["((o^_^o)-(ﾟΘﾟ))", "2"],
    ["(o^_^o)", "3"],
    ["(ﾟｰﾟ)", "4"],
    ["((ﾟｰﾟ)+(ﾟΘﾟ))", "5"],
    ["((o^_^o)+(o^_^o))", "6"],
    ["((ﾟｰﾟ)+(o^_^o))", "7"],
    ["((ﾟｰﾟ)+(ﾟｰﾟ))", "8"],
    ["((ﾟｰﾟ)+(ﾟｰﾟ)+(ﾟΘﾟ))", "9"],
    ["(ﾟДﾟ).ﾟωﾟﾉ", "a"],
    ["(ﾟДﾟ).ﾟΘﾟﾉ", "b"],
    ["(ﾟДﾟ)['c']", "c"],
    ["(ﾟДﾟ).ﾟｰﾟﾉ", "d"],
    ["(ﾟДﾟ).ﾟДﾟﾉ", "e"],
    ["(ﾟДﾟ)[ﾟΘﾟ]", "f"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

const AA_ESCAPE = "(ﾟДﾟ)[ﾟεﾟ]+";
const AA_UNICODE = "(oﾟｰﾟo)+";

/** Yosuke Hasegawa's aaencode, undone: every character is `\` + octal digits, or `\u` + hex digits for code >= 128. */
export function aadecode(text: string): string {
  const flat = text.replace(/\s+/g, "");
  const begin = flat.indexOf("(ﾟДﾟ)['_']((ﾟДﾟ)['_'](ﾟεﾟ+(ﾟДﾟ)[ﾟoﾟ]+");
  const end = flat.lastIndexOf("(ﾟДﾟ)[ﾟoﾟ])(ﾟΘﾟ))");
  if (begin < 0 || end < begin) throw new Error("not aaencode");
  const body = flat.slice(flat.indexOf("(ﾟДﾟ)[ﾟoﾟ]+", begin) + "(ﾟДﾟ)[ﾟoﾟ]+".length, end);
  let out = "";
  for (const chunk of body.split(AA_ESCAPE)) {
    if (!chunk) continue;
    const unicode = chunk.startsWith(AA_UNICODE);
    let digits = unicode ? chunk.slice(AA_UNICODE.length) : chunk;
    for (const [expr, d] of AA_DIGITS) digits = digits.split(expr).join(d);
    digits = digits.replace(/\+/g, "");
    if (!/^[0-9a-f]+$/.test(digits)) throw new Error(`aaencode: unexpected ${chunk.slice(0, 40)}`);
    out += String.fromCharCode(parseInt(digits, unicode ? 16 : 8));
  }
  return out;
}
