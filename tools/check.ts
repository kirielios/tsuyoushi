// Smoke-test built extensions against their live sites: popular, latest, search, details + chapters, pages, first image.
//   npm run build && npm run check -- en.mangapill          one extension, verbose
//   npm run check -- --all --parallel 8                     everything in dist/, one line each + .upstream/check.json
import { readFileSync, writeFileSync } from "node:fs";
import { nodeHost } from "./node-host.ts";
import type { KeiSource } from "../sdk/source.ts";

type Entry = { id: string; pkg: string; name: string; lang: string; baseUrl: string };
type Step = { step: string; ok: boolean; ms: number; note?: string };
type Result = { id: string; name: string; baseUrl: string; steps: Step[]; info: Record<string, unknown> };

const index = JSON.parse(readFileSync("dist/index.json", "utf8")) as { extensions: Entry[] };
const argv = process.argv.slice(2);
const all = argv.includes("--all");
const parallel = Number(argv[argv.indexOf("--parallel") + 1]) || 1;
const wanted = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--parallel");
const entries = index.extensions.filter((e) => all || wanted.includes(e.pkg) || wanted.includes(e.id));
if (!entries.length) throw new Error(`nothing to check for ${wanted.join(" ")} - run npm run build first`);
const verbose = entries.length === 1;

async function checkOne(entry: Entry): Promise<Result> {
  const r: Result = { id: entry.id, name: entry.name, baseUrl: entry.baseUrl, steps: [], info: {} };
  const code = readFileSync(`dist/${entry.pkg}/index.js`, "utf8");
  const mod = new Function(`${code}\nreturn __tsuyoushi;`)() as { create(h: unknown, m: unknown): KeiSource };
  const src = mod.create(nodeHost(), entry);
  const step = async <T>(label: string, run: () => Promise<T>, ok: (v: T) => string | true): Promise<T | undefined> => {
    const t0 = performance.now();
    try {
      const v = await Promise.race([run(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out after 60 s")), 60_000))]);
      const verdict = ok(v);
      r.steps.push({ step: label, ok: verdict === true, ms: Math.round(performance.now() - t0), note: verdict === true ? undefined : verdict });
      return v;
    } catch (e) {
      r.steps.push({ step: label, ok: false, ms: Math.round(performance.now() - t0), note: (e as Error).message.slice(0, 160) });
    }
  };
  const popular = await step("popular", () => src.getPopularManga(1), (p) => (p.mangas.length ? true : "no manga"));
  if (src.supportsLatest) await step("latest", () => src.getLatestUpdates(1), (p) => (p.mangas.length ? true : "no manga"));
  const first = popular?.mangas[0];
  if (!first) return r;
  r.info.first = `${first.title} ${first.url}`;
  let data: unknown = null;
  if (src.supportsFilterFetching) data = await step("filter data", () => src.fetchFilterData(), () => true);
  await step("filters", async () => src.getFilterList(data ?? null), () => true);
  const word = first.title.split(/\s+/).find((w) => /^[A-Za-z]{3,}$/.test(w)) ?? first.title;
  await step("search", () => src.getSearchManga(1, word, src.getFilterList(data ?? null)), (p) => (p.mangas.length ? true : `no results for "${word}"`));
  const update = await step("details", () => src.fetchMangaUpdate(first, [], true, true), (u) => (u.manga.title || first.title ? (u.chapters.length ? true : "no chapters") : "no title"));
  if (!update?.chapters.length) return r;
  const dated = update.chapters.filter((c) => c.date_upload > 0).length;
  Object.assign(r.info, { status: update.manga.status, chapters: update.chapters.length, dated, genres: (update.manga.genre ?? "").slice(0, 50) });
  const pages = await step("pages", () => src.getPageList(update.chapters.find((c) => !c.name.includes("🔒")) ?? update.chapters[0]), (p) => (p.length ? true : "no pages"));
  const page = pages?.[0];
  if (!page) return r;
  r.info.pages = pages!.length;
  await step("image", async () => {
    const res = await src.getImage(page.imageUrl ? page : { ...page, imageUrl: await src.getImageUrl(page) });
    return { status: res.code, type: res.header("content-type") ?? "" };
  }, (x) => (x.status === 200 && /^(image\/|text\/plain|application\/octet-stream)/.test(x.type) ? true : `HTTP ${x.status} ${x.type}`));
  return r;
}

const results: Result[] = [];
const queue = [...entries];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let e; (e = queue.shift()); ) {
      const r = await checkOne(e);
      results.push(r);
      const bad = r.steps.filter((s) => !s.ok);
      if (verbose) {
        console.log(`\n${r.id}  ${r.name}  ${r.baseUrl}`);
        for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"}  ${s.step} (${s.ms} ms)${s.note ? `: ${s.note}` : ""}`);
        console.log(`        ${JSON.stringify(r.info)}`);
      } else {
        const marks = r.steps.map((s) => `${s.step}${s.ok ? "" : "✗"}`).join(" ");
        console.log(`${bad.length ? "FAIL" : "ok  "} ${r.id.padEnd(34)} ${marks}${bad.length ? `  | ${bad[0].step}: ${bad[0].note}` : ` | ch=${r.info.chapters} dated=${r.info.dated} pages=${r.info.pages}`}`);
      }
    }
  }),
);
const passed = results.filter((r) => r.steps.length && r.steps.every((s) => s.ok));
if (all) writeFileSync(".upstream/check.json", JSON.stringify(results.sort((a, b) => a.id.localeCompare(b.id)), null, 2));
console.log(`\n${passed.length}/${results.length} sources passed every step${all ? " (details: .upstream/check.json)" : ""}`);
process.exit(passed.length === results.length ? 0 : 1);
