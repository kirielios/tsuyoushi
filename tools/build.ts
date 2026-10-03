// Bundle every ported extension into dist/<pkg>/index.js and write dist/index.json, the URL users paste into the app.
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export const FORMAT = "mangareader-kei/1";

type Meta = { pkg: string; name: string; upstreamVersionCode: number; port: number; contentWarning: string; theme?: string; sources: { lang: string; baseUrl: string; name?: string; mirrors?: string[]; customUrl?: boolean }[] };

// --only a.b,c.d rebuilds just those packages and merges them into the existing index (parallel porting)
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1]?.split(",")) : null;
type Entry = Record<string, unknown> & { id: string; pkg: string };
const entries: Entry[] = [];
if (only) {
  const lock = "dist/.lock";
  while (existsSync(lock)) await new Promise((r) => setTimeout(r, 200)); // ponytail: naive lock between parallel --only builds
  writeFileSync(lock, "");
  process.on("exit", () => rmSync(lock, { force: true }));
  entries.push(...(JSON.parse(readFileSync("dist/index.json", "utf8")).extensions as Entry[]).filter((e) => !only.has(e.pkg)));
} else rmSync("dist", { recursive: true, force: true });
for (const lang of readdirSync("src")) {
  for (const name of readdirSync(`src/${lang}`)) {
    const dir = `src/${lang}/${name}`;
    if (!existsSync(`${dir}/index.ts`)) continue; // generated but not ported yet
    const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as Meta;
    if (only && !only.has(meta.pkg)) continue;
    const out = `dist/${meta.pkg}`;
    mkdirSync(out, { recursive: true });
    // `create(host, meta)` on a global: the app evaluates the bundle and calls it once per source
    await build({
      // mirrors / custom URL per lang are baked in: the app rebuilds meta from its DB row, which has neither
      stdin: {
        contents: `import S from "./index.ts"; const URLS = ${JSON.stringify(Object.fromEntries(meta.sources.map((s) => [s.lang, { mirrors: s.mirrors, customUrl: s.customUrl }])))}; export const create = (host, meta) => new S(host, { ...meta, ...URLS[meta.lang] });`,
        resolveDir: dir,
        loader: "ts",
      },
      bundle: true,
      format: "iife",
      globalName: "__tsuyoushi",
      platform: "neutral",
      target: "es2022",
      minify: true,
      legalComments: "none",
      banner: { js: `/* ${meta.name} - ported from Keiyoushi (Apache-2.0), see NOTICE */` },
      outfile: `${out}/index.js`,
      logLevel: "warning",
    });
    const hash = createHash("sha256").update(readFileSync(`${out}/index.js`)).digest("hex").slice(0, 6);
    if (existsSync(`${dir}/icon.png`)) copyFileSync(`${dir}/icon.png`, `${out}/icon.png`);
    for (const [i, s] of meta.sources.entries()) {
      // several sources in one lang (Komga, Komga (2), …): the 2nd gets ":2", the 3rd ":3"
      const dup = meta.sources.slice(0, i).filter((o) => o.lang === s.lang).length;
      entries.push({
        id: `kei:${meta.pkg}:${s.lang}${dup ? `:${dup + 1}` : ""}`,
        pkg: meta.pkg,
        name: s.name ?? meta.name,
        lang: s.lang,
        baseUrl: s.baseUrl,
        // +hash of the bundle: SDK and theme fixes change the code without touching upstream's or the port's number
        version: `${meta.upstreamVersionCode}.${meta.port}+${hash}`,
        upstreamVersionCode: meta.upstreamVersionCode,
        contentWarning: meta.contentWarning,
        theme: meta.theme,
        icon: `${meta.pkg}/icon.png`,
        bundle: `${meta.pkg}/index.js`,
      });
    }
  }
}
entries.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync("dist/index.json", JSON.stringify({ format: FORMAT, name: "Tsuyoushi (en/id)", extensions: entries }, null, 2) + "\n");
console.log(`built ${new Set(entries.map((e) => e.pkg)).size} extensions, ${entries.length} sources -> dist/index.json`);
