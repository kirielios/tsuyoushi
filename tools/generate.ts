// Scaffold src/<lang>/<name>/ from the upstream checkout (npm run upstream): meta.json and icon.png always, and
// index.ts when tools/translate.ts can translate the whole extension. Hand-written ports are never overwritten.
//   npm run generate -- en/mangapill id/komikcast
//   npm run generate -- --theme madara --theme mangathemesia      (every en/id extension on those themes)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED, translate } from "./translate.ts";

const UP = ".upstream/extensions-source";
const LANGS = new Set(["en", "id", "all"]); // scope: English and Indonesian; "all" = language-neutral, mostly English
if (!existsSync(UP)) throw new Error(`${UP} missing: run npm run upstream first`);

const str = (src: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`).exec(src)?.[1];
/** The whole `source { ... }` block starting at `at`, nested braces included (baseUrl { mirrors(...) }). */
function sourceBlock(src: string, at: number): string {
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}
/**
 * `baseUrl = "x"`, `baseUrl { mirrors("a", "b") }` (the user picks one; the first is the default) or
 * `baseUrl { custom("x") }` (the user may replace it). Alternatives are recorded for a later settings screen.
 */
function baseUrls(block: string): { baseUrl: string; mirrors?: string[]; customUrl?: boolean } {
  const plain = str(block, "baseUrl");
  if (plain) return { baseUrl: plain };
  const mirrors = /mirrors\(([^)]*)\)/.exec(block);
  if (mirrors) {
    const list = [...mirrors[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { baseUrl: list[0] ?? "", mirrors: list };
  }
  const custom = /custom\(\s*"([^"]+)"/.exec(block);
  return custom ? { baseUrl: custom[1], customUrl: true } : { baseUrl: "" };
}
/**
 * The langs of the `forEach` loop enclosing the source block at `at`, with the loop variables. The collection may be
 * inline or a `val`, a list of strings or of `"en" to x` pairs (listOf/mapOf):
 *   listOf("en", "ko").forEach { source { lang = it } }
 *   val subs = mapOf("en" to "www"); subs.forEach { (langCode, sub) -> source { lang = langCode; baseUrl = "https://$sub.x" } }
 */
function loopValues(gradle: string, at: number): { lang: string; vars: Record<string, string> }[] | undefined {
  const headers = [...gradle.slice(0, at).matchAll(/(?:(\w+)|(?:listOf|mapOf)\(([^)]*)\))\s*\.forEach\s*\{\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+))?\s*(?:->)?/g)];
  const h = headers.at(-1);
  if (!h) return undefined;
  const [, name, inline, k, v, single] = h;
  const body = inline ?? new RegExp(`\\bval\\s+${name}\\s*=\\s*(?:listOf|mapOf)\\(([^)]*)\\)`).exec(gradle)?.[1];
  if (body === undefined) return undefined;
  const pairs = [...body.matchAll(/"([^"]+)"\s+to\s+("([^"]*)"|[^,\s)]+)/g)];
  if (pairs.length) return pairs.map((m) => ({ lang: m[1], vars: { [k ?? "it"]: m[1], ...(v ? { [v]: m[3] ?? m[2] } : {}) } }));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => ({ lang: m[1], vars: { [single ?? "it"]: m[1] } }));
}
const kotlinFiles = (dir: string): { name: string; text: string }[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? kotlinFiles(p) : f.endsWith(".kt") ? [{ name: f, text: readFileSync(p, "utf8") }] : [];
      })
    : [];

const argv = process.argv.slice(2);
const themes = argv.flatMap((a, i) => (argv[i - 1] === "--theme" ? [a] : []));
const paths = argv.filter((a, i) => a !== "--theme" && argv[i - 1] !== "--theme");
if (themes.length) {
  for (const lang of ["en", "id", "all"])
    for (const name of readdirSync(`${UP}/src/${lang}`)) {
      const gradle = `${UP}/src/${lang}/${name}/build.gradle.kts`;
      if (existsSync(gradle) && themes.includes(str(readFileSync(gradle, "utf8"), "theme") ?? "")) paths.push(`${lang}/${name}`);
    }
}

const done = { generated: 0, kept: 0, manual: [] as string[], skipped: [] as string[] };
for (const path of paths) {
  const [dirLang, name] = path.split("/");
  // `val dbmUrl = "https://…"` … `baseUrl = dbmUrl`: inline string vals so the literal parsers see them
  let gradle = readFileSync(`${UP}/src/${path}/build.gradle.kts`, "utf8");
  for (const [, name, value] of gradle.matchAll(/\bval\s+(\w+)\s*=\s*("[^"]*")/g)) gradle = gradle.replace(new RegExp(`(=\\s*)${name}\\b`, "g"), `$1${value}`);
  const blocks = [...gradle.matchAll(/\bsource\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const sources = (blocks.length ? [...gradle.matchAll(/\bsource\s*\{/g)].map((m) => ({ b: sourceBlock(gradle, m.index!), at: m.index! })) : [{ b: gradle, at: 0 }])
    // One source per iterated lang, with the loop variables substituted into the block's string templates:
    //   listOf("en", "ko").forEach { source { lang = it; baseUrl = "https://x/$it" } }
    //   mapOf("en" to "www").forEach { (langCode, sub) -> source { lang = langCode; baseUrl = "https://$sub.x" } }
    .flatMap(({ b, at }) => {
      const iterated = /\blang\s*=\s*[A-Za-z_]\w*\s*$/m.test(b) ? loopValues(gradle, at) : undefined;
      if (!iterated) return [{ lang: str(b, "lang") ?? dirLang, ...baseUrls(b), name: str(b, "name") }];
      return iterated.map(({ lang, vars }) => {
        const block = Object.entries(vars).reduce((acc, [k, v]) => acc.replace(new RegExp(`\\$(\\{${k}\\}|${k}\\b)`, "g"), v), b);
        return { lang, ...baseUrls(block), name: str(block, "name") };
      });
    })
    .filter((s) => LANGS.has(s.lang) && s.baseUrl);
  if (!sources.length) {
    done.skipped.push(`${path}: no en/id source with a baseUrl in build.gradle.kts`);
    continue;
  }
  const dir = `src/${path}`;
  mkdirSync(dir, { recursive: true });
  const previous = existsSync(`${dir}/meta.json`) ? (JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as { port?: number }) : {};
  const meta = {
    pkg: `${dirLang}.${name}`,
    name: str(gradle, "name") ?? name,
    upstreamVersionCode: Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1] ?? 0),
    port: previous.port ?? 1, // our own revision: bump when a port changes without an upstream versionCode bump
    libVersion: str(gradle, "libVersion") ?? "",
    contentWarning: /ContentWarning\.(\w+)/.exec(gradle)?.[1] ?? "SAFE",
    theme: str(gradle, "theme"),
    sources,
  };
  writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 2) + "\n");
  // the extension's own launcher icon, else its theme's (Keiyoushi themed extensions without res/ share it)
  const theme = str(gradle, "theme");
  const icon = [`${UP}/src/${path}/res/mipmap-xxxhdpi/ic_launcher.png`, ...(theme ? [`${UP}/lib-multisrc/${theme}/res/mipmap-xxxhdpi/ic_launcher.png`] : [])].find(existsSync);
  if (icon) copyFileSync(icon, `${dir}/icon.png`);

  const index = `${dir}/index.ts`;
  const handWritten = existsSync(index) && !readFileSync(index, "utf8").includes(GENERATED);
  if (handWritten) {
    done.kept++;
    continue;
  }
  const t = translate(kotlinFiles(`${UP}/src/${path}/src`), `src/${path}`);
  if (t.ok) {
    writeFileSync(index, t.code);
    done.generated++;
  } else done.manual.push(`${path}: ${t.reason}`);
}

console.log(`${paths.length} extensions: ${done.generated} translated, ${done.kept} hand ports kept, ${done.manual.length} need a hand port, ${done.skipped.length} skipped`);
for (const m of done.manual) console.log(`  port by hand  ${m}`);
for (const s of done.skipped) console.log(`  skipped       ${s}`);
