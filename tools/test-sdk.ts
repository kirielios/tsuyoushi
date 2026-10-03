// Self-check for the SDK pieces most likely to be subtly wrong. npm test
import assert from "node:assert/strict";
import { load } from "cheerio";
import { DateTimeFormatter, DateTimeFormatterBuilder, Locale, ZoneOffset, ZoneId } from "../sdk/time.ts";
import { md5, toHex, evpBytesToKey, aesCbcDecrypt, utf8, fromUtf8, Base64 } from "../sdk/crypto.ts";
import { Intl, parseProperties } from "../sdk/i18n.ts";
import { ClientBuilder, HttpClient, Response } from "../sdk/network.ts";
import { parseHtml } from "../sdk/jsoup.ts";
import type { Host } from "../sdk/host.ts";
import { toHttpUrl } from "../sdk/httpurl.ts";
import { urlWithoutDomain } from "../sdk/models.ts";
import { decodeProto, type ProtoSchema } from "../sdk/protobuf.ts";
import { Filter, firstInstance, firstInstanceOrNull } from "../sdk/filters.ts";
import { tryParseInstant } from "../sdk/time.ts";
import { extractNextJsFromDocument, extractNextJsRsc, hasKeys } from "../sdk/nextjs.ts";

const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);
let n = 0;
const eq = (a: unknown, b: unknown, msg = "") => (assert.equal(a, b, msg || `expected ${String(b)}`), n++);

// --- dates: the patterns Madara and MangaThemesia sources actually declare
const en = (p: string, l = Locale.US) => DateTimeFormatter.ofPattern(p, l);
eq(en("MMMM d, yyyy").tryParseDate("September 28, 2026", ZoneOffset.UTC), utc(2026, 9, 28));
eq(en("MMMM d, yyyy").tryParseDate("september 28, 2026", ZoneOffset.UTC), utc(2026, 9, 28), "case-insensitive text");
eq(en("dd/MM/yyyy", Locale.ROOT).tryParseDate("05/03/2024", ZoneOffset.UTC), utc(2024, 3, 5));
eq(en("MM/dd/yyyy").tryParseDate("3/5/2024", ZoneOffset.UTC), utc(2024, 3, 5), "one-digit MM/dd accepted");
eq(en("MMM d, uuuu").tryParseDate("Sep 5, 2023", ZoneOffset.UTC), utc(2023, 9, 5));
eq(en("d MMM yyyy").tryParseDate("5 Sept 2023", ZoneOffset.UTC), utc(2023, 9, 5), "a longer short form still matches");
eq(en("dd MMM yyyy").tryParseDate("05 Dec 2025", ZoneOffset.UTC), utc(2025, 12, 5));
eq(en("yyyy-MM-dd").tryParseDate("2024-02-29", ZoneOffset.UTC), utc(2024, 2, 29), "leap day");
eq(en("MMMM d, yyyy").tryParseDate("February 30, 2024", ZoneOffset.UTC), 0, "invalid date rejected");
eq(en("MMMM d, yyyy").tryParseDate("Updated 3 days ago", ZoneOffset.UTC), 0, "no partial match");
eq(en("MMMM d, yyyy").tryParseDate(null), 0);
eq(en("dd/MM/yy").tryParseDate("01/02/24", ZoneOffset.UTC), utc(2024, 2, 1), "two-digit year");
const id = new Locale("id");
eq(DateTimeFormatter.ofPattern("MMMM d, yyyy", id).tryParseDate("Mei 3, 2024", ZoneOffset.UTC), utc(2024, 5, 3), "Indonesian month");
eq(DateTimeFormatter.ofPattern("d MMMM yyyy", id).tryParseDate("17 Agustus 2025", ZoneOffset.UTC), utc(2025, 8, 17));
{
  // optional sections "[...]" (Kotlin's "[MMMM][MMM] d, yyyy, h[:mm] a"): with and without the optional part
  const opt = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("[MMMM][MMM] d, yyyy, h[:mm] a").toFormatter(Locale.ENGLISH);
  eq(opt.tryParseDateTime("Sep 13, 2026, 3 pm", ZoneOffset.UTC), Date.UTC(2026, 8, 13, 15, 0), "optional minutes absent");
  eq(opt.tryParseDateTime("March 5, 2026, 3:30 am", ZoneOffset.UTC), Date.UTC(2026, 2, 5, 3, 30), "optional minutes present");
}
eq(DateTimeFormatter.ofPattern("d MMM yyyy", id).tryParseDate("17 Agu 2025", ZoneOffset.UTC), utc(2025, 8, 17), "Indonesian short month");
eq(DateTimeFormatter.ofPattern("MMMM dd, yyyy", id).tryParseDate("Agu 17, 2021", ZoneOffset.UTC), utc(2021, 8, 17), "short form under a full-month pattern (KlikManga)");
eq(DateTimeFormatter.ofPattern("MMMM dd, yyyy", id).tryParseDate("Maret 02, 2024", ZoneOffset.UTC), utc(2024, 3, 2), "full form still parses");
eq(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", id).tryParseDate("Senin, 5 Agustus 2024", ZoneOffset.UTC), utc(2024, 8, 5), "weekday consumed");
eq(new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("MMMM d, yyyy").toFormatter(Locale.forLanguageTag("en")).tryParseDate("JUNE 1, 2025", ZoneOffset.UTC), utc(2025, 6, 1));
eq(en("yyyy-MM-dd HH:mm:ss").tryParseDateTime("2024-05-01 13:04:05", ZoneOffset.UTC), utc(2024, 5, 1, 13, 4, 5));
eq(en("yyyy-MM-dd hh:mm a").tryParseDateTime("2024-05-01 01:04 PM", ZoneOffset.UTC), utc(2024, 5, 1, 13, 4));
eq(en("yyyy-MM-dd HH:mm").tryParseDateTime("2024-05-01 10:00", ZoneId.of("Asia/Jakarta")), utc(2024, 5, 1, 3, 0), "IANA zone (+7)");
eq(en("yyyy-MM-dd'T'HH:mm:ssXXX").tryParseZonedDateTime("2024-05-01T10:00:00+07:00"), utc(2024, 5, 1, 3, 0), "offset in the text");
eq(en("yyyy-MM-dd").withZone(ZoneOffset.ofHours(7)).tryParseDate("2024-05-01"), utc(2024, 4, 30, 17), "formatter zone");

// --- crypto: RFC 1321 vectors, then OpenSSL EVP key derivation + AES round trip
eq(toHex(md5("")), "d41d8cd98f00b204e9800998ecf8427e");
eq(toHex(md5("The quick brown fox jumps over the lazy dog")), "9e107d9d372bb6826bd81d3542a419d6");
eq(toHex(md5("a".repeat(1000))), "cabe45dcc9ae5b66ba86600cca6b8ba8", "multi-block");
const { key, iv } = evpBytesToKey(utf8("nonce123"), utf8("saltsalt"));
const ck = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, ck, utf8('["a.jpg","b.jpg"]') as BufferSource));
eq(fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(Base64.encode(sealed)))), '["a.jpg","b.jpg"]');

// --- i18n
const intl = new Intl({ language: "id", baseLanguage: "en", availableLanguages: ["en", "es"], messages: { en: { a: "Author", f: "Project %s of %s" }, es: { a: "Autor" } } });
eq(intl.get("a"), "Author", "unknown language falls back to English");
eq(intl.get("zz"), "[zz]");
eq(intl.format("f", "X", 3), "Project X of 3");
eq(parseProperties("a=Hello\\u0021\n# c\nb = x\\\n  y\n").b, "xy");

// --- Jsoup text(): spaces at block boundaries, none inside inline runs, scripts excluded
const doc = parseHtml(load, "<div><p>He<b>llo</b></p><p>world</p><script>x()</script> <span>a</span>b<br>c</div>", "https://x.test/a/");
eq(doc.selectFirst("div")!.text(), "Hello world ab c");
// abs:srcset keeps its descriptors like Jsoup (java.net.URL does not encode spaces)
eq(parseHtml(load, '<img srcset="/a.jpg 175w, /b.jpg 350w">', "https://x.test/p/").selectFirst("img")!.attr("abs:srcset"), "https://x.test/a.jpg 175w, /b.jpg 350w");
{
  // Jsoup's select includes the element itself (Madara's pageListParseSelector may match the <img> directly)
  const img = parseHtml(load, '<div class="r"><img src="/1.jpg"><img src="/2.jpg"></div>', "https://x.test/").select(".r img");
  eq(img.map((e) => e.selectFirst("img")?.attr("src")).join(","), "/1.jpg,/2.jpg");
  eq(parseHtml(load, "<div><p>a</p></div>", "https://x.test/").selectFirst("div")!.select("div").length, 1);
}
eq(parseHtml(load, '<a href="../b">x</a>', "https://x.test/a/c").selectFirst("a")!.attr("abs:href"), "https://x.test/b");
eq(parseHtml(load, "<a>x</a> 2020-01-02<br>", "https://x.test/").selectFirst("a")!.nextSiblingText(), " 2020-01-02");
eq(parseHtml(load, "<a>x</a><br>", "https://x.test/").selectFirst("a")!.nextSiblingText(), null);
eq(parseHtml(load, '<a class="n" title="Next page" href="/x">1</a><a class="n" title="Next">2</a>', "https://x.test/").select("a.n[title=Next page]").attr("href"), "/x");
{
  const d = parseHtml(load, '<div class="c"><h4>m</h4><h4>n</h4><ul><li><a>x</a></li></ul></div>', "https://x.test/");
  const a = d.selectFirst("a")!;
  eq(a.closest(".c")!.tagName(), "div");
  eq(a.closest(".zz"), null);
  eq(a.parents()[1].tagName(), "ul");
  eq(d.selectFirst("ul")!.previousElementSiblings().select("h4").first()!.text(), "n");
}
{
  const kids = parseHtml(load, "<p>a  b<br><i>c</i><!--x--></p>", "https://x.test/").selectFirst("p")!.childNodes();
  eq(kids.length, 3);
  eq(kids[0], "a b");
  eq(typeof kids[2] === "string" ? "" : kids[2].text(), "c");
}
{
  // Elements.remove() detaches from the document (RageScans drops #comments before parsing details)
  const d = parseHtml(load, '<div><p id="c">x</p><p>y</p></div>', "https://x.test/");
  d.select("#c").remove();
  eq(d.selectFirst("div")!.text(), "y");
}
{
  // Jsoup pseudos (Keyoapp): :containsOwn, :matches / :matchesOwn (Java regex), :containsData
  const d = parseHtml(load, '<div id="c"><div><span>Status</span></div><div>Ongoing</div><span>Novel</span><a><i>Upcoming</i></a><a>ch 1</a><script>initDropdown({})</script></div>', "https://x.test/");
  eq(d.selectFirst("div:has(span:containsOwn(status)) ~ div")?.text(), "Ongoing", ":containsOwn");
  eq(d.select("span:matchesOwn((?i)^novel$)").length, 1, ":matchesOwn with (?i)");
  eq(d.select("#c > a:not(:has(i:matches(Upcom\\w+)))").text(), "ch 1", ":matches regex with \\w");
  eq(d.select("script:containsData(initDropdown)").length, 1, ":containsData");
  eq(d.select("#c > div:contains(ONGOING)").length, 1, ":contains is case-insensitive (MangaBox li:contains(author))");
  eq(d.selectFirst("span:matchesOwn(^Novel$)")!.selectFirst("span:matchesOwn(Novel)")?.text(), "Novel", "self match keeps custom pseudos");
  eq(parseHtml(load, "<ul><li><a>a</a><a>b</a></li><li><a>c</a></li></ul>", "https://x.test/").select("li a:eq(0)").eachText().join(), "a,c", ":eq(n) is the sibling index");
  eq(parseHtml(load, '<div wire:model.live="genre"><option>A</option></div>', "https://x.test/").select("[wire:model.live=genre] option").length, 1, "attribute name with : and .");
}

// --- HttpUrl.Builder, OkHttp semantics (MangaThemesia builds search URLs with it)
eq(toHttpUrl("https://x.test").newBuilder().addPathSegment("manga").addQueryParameter("title", "a b").addPathSegment("").build().toString(), "https://x.test/manga/?title=a+b", "segment replaces the empty root, trailing slash");
eq(toHttpUrl("https://x.test/manga/").newBuilder().addPathSegments("page/2/").build().toString(), "https://x.test/manga/page/2/");
eq(toHttpUrl("https://x.test/manga/").newBuilder().setPathSegment(0, "project").build().toString(), "https://x.test/project/");
eq(toHttpUrl("https://x.test/search/").newBuilder().addPathSegment("a b").addEncodedPathSegments("mpage/2/").build().toString(), "https://x.test/search/a%20b/mpage/2/", "addEncodedPathSegments");
eq(toHttpUrl("https://x.test").newBuilder().addPathSegment("a/b").build().encodedPath, "/a%2Fb", "slash inside one segment is encoded");
eq(toHttpUrl("https://x.test/a/b/").pathSegments.join("|"), "a|b|");
eq(toHttpUrl("https://x.test/search/").newBuilder().addQueryParameter("s", "1").addEncodedQueryParameter("key", 'a+b,%2Btag:"x"').build().toString(), "https://x.test/search/?s=1&key=a+b,%2Btag:%22x%22", "addEncodedQueryParameter keeps + and %2B");
eq(toHttpUrl("https://x.test/?p=12&q=x").queryParameter("p"), "12");

// --- rate limit really waits: 3 requests at 2 per 300 ms -> the third leaves >= ~300 ms after the first
const times: number[] = [];
const host = { userAgent: "t", load, prefs: { get: () => undefined, set: () => undefined }, fetch: async (url: string) => (times.push(Date.now()), { status: 200, url, headers: {}, body: new Uint8Array() }) } as Host;
const client = new HttpClient(host, () => new Headers(), new ClientBuilder().rateLimit(2, 300));
await Promise.all([1, 2, 3].map((i) => client.get(`https://x.test/${i}`)));
assert.ok(times[2] - times[0] >= 290, `third request after ${times[2] - times[0]} ms`);
n++;

// --- chain interceptors see the response and can retry through the rest of the chain
{
  const seen: string[] = [];
  const h = { ...host, fetch: async (url: string) => (seen.push(url), { status: url.endsWith("ok") ? 200 : 403, url, headers: {}, body: new Uint8Array() }) } as Host;
  const b = new ClientBuilder().addChainInterceptor(async (chain) => {
    const res = await chain.proceed(chain.request());
    return res.code === 403 ? chain.proceed({ ...chain.request(), url: chain.request().url + "?ok" }) : res;
  });
  eq((await new HttpClient(h, () => new Headers(), b).get("https://x.test/a")).code, 200);
  eq(seen.join(" "), "https://x.test/a https://x.test/a?ok");
}

// --- Jsoup parity: <noscript> content is parsed, wholeText keeps <br> as "\n"; OkHttp bare query parameters
{
  const d = parseHtml(load, '<div><noscript><img src="/real.jpg"></noscript><p>a<br>b</p></div>', "https://x.test/");
  eq(d.selectFirst("noscript img")?.attr("abs:src"), "https://x.test/real.jpg", "noscript parsed as elements");
  eq(d.selectFirst("p")!.wholeText(), "a\nb", "wholeText <br>");
  eq(toHttpUrl("https://x.test/i.jpg").newBuilder().addQueryParameter("123", null).addQueryParameter("w", "2").build().toString(), "https://x.test/i.jpg?123&w=2", "null value -> bare name");
}

// --- the request's #fragment survives into response.url (OkHttp response.request.url), but not across a redirect
{
  const h = { ...host, fetch: async (url: string) => ({ status: 200, url: url.split("#")[0].replace("/moved", "/new"), headers: {}, body: new Uint8Array() }) } as Host;
  const c = new HttpClient(h, () => new Headers(), new ClientBuilder());
  eq((await c.get("https://x.test/a?p=1#q=hi")).url, "https://x.test/a?p=1#q=hi", "fragment kept");
  eq((await c.get("https://x.test/moved#q=hi")).url, "https://x.test/new", "redirect drops fragment");
}

// --- cookie jar: domain cookies reach subdomains, host-only ones do not, Max-Age=0 deletes; the client sends them
{
  const { CookieJar } = await import("../sdk/cookies.ts");
  const jar = new CookieJar();
  jar.saveFromResponse("https://www.x.test/", ["a=1; Domain=.x.test; Path=/", "b=2", "c=3; Domain=other.test"]);
  eq(jar.loadForRequest("https://cdn.x.test/i.jpg").map((c) => c.name).join(), "a", "domain cookie on a subdomain");
  eq(jar.loadForRequest("https://www.x.test/").map((c) => c.name).join(), "a,b", "host-only cookie on its host");
  jar.set("https://www.x.test/", "a=0; Max-Age=0; Domain=x.test");
  eq(jar.loadForRequest("https://www.x.test/").map((c) => c.name).join(), "b", "Max-Age=0 deletes");
  const sent: string[] = [];
  const h = { ...host, fetch: async (url: string, init: { headers: Record<string, string> }) => (sent.push(init.headers.Cookie ?? ""), { status: 200, url, headers: {}, setCookies: ["s=9; Domain=x.test"], body: new Uint8Array() }) } as Host;
  const c = new HttpClient(h, () => new Headers(), new ClientBuilder());
  await c.get("https://www.x.test/1");
  await c.get("https://img.x.test/2");
  eq(sent.join("|"), "|s=9", "Set-Cookie from a response is sent to a sibling subdomain");
  await c.get("https://img.x.test/3", new Headers({ Cookie: "k=1; s=old" }));
  eq(sent[2], "k=1; s=9", "an explicit Cookie header keeps pairs the jar lacks; the jar wins for the same name");
}

// --- generated base-URL preferences: preferred mirror by index, custom URL sanitised to an origin
{
  const { KeiSource, sanitizeBaseUrl } = await import("../sdk/source.ts");
  class S extends KeiSource {
    async getPopularManga() { return { mangas: [], hasNextPage: false }; }
    async getLatestUpdates() { return { mangas: [], hasNextPage: false }; }
    async getSearchMangaList() { return { mangas: [], hasNextPage: false }; }
    async fetchMangaUpdate(): Promise<never> { throw new Error(); }
    async getPageList() { return []; }
  }
  const prefs: Record<string, unknown> = {};
  const h = { ...host, prefs: { get: (k: string) => prefs[k], set: (k: string, v: unknown) => void (prefs[k] = v) } } as Host;
  const meta = { id: "x", pkg: "x", name: "x", lang: "en", contentWarning: "SAFE", version: "1", upstreamVersionCode: 1 } as const;
  const m = new S(h, { ...meta, baseUrl: "https://a.test", mirrors: ["https://a.test", "https://b.test"] } as never);
  eq(m.baseUrl, "https://a.test");
  prefs.preferred_mirror = "1";
  eq(m.baseUrl, "https://b.test", "preferred mirror");
  const screen = { items: [] as { key: string }[], addPreference(p: { toDef(): { key: string } }) { this.items.push(p.toDef()); return true; } };
  m.buildPreferenceScreen(screen as never);
  eq(screen.items.map((i) => i.key).join(), "preferred_mirror");
  const c = new S(h, { ...meta, baseUrl: "http://127.0.0.1:9000", customUrl: true } as never);
  eq(c.baseUrl, "http://127.0.0.1:9000", "custom default");
  prefs.overrideBaseUrl = "https://my.host:8443/some/path";
  eq(c.baseUrl, "https://my.host:8443", "custom override reduced to origin");
  eq(sanitizeBaseUrl("  "), null);
  eq(sanitizeBaseUrl("javascript:alert(1)"), null, "only http(s)");
}

// --- ParsedHttpSource (1.4 API) over KeiSource: request/parse pairs behind the 1.6 entry points
{
  const { ParsedHttpSource, GET } = await import("../sdk/httpsource.ts");
  const { SManga, SChapter, Page } = await import("../sdk/models.ts");
  type El = import("../sdk/jsoup.ts").Element;
  const pages: Record<string, string> = {
    "https://p.test/popular?page=1": '<div class="m"><a href="/m/a">A</a></div><div class="m"><a href="/m/b">B</a></div><a class="next">n</a>',
    "https://p.test/m/a": '<p class="d">desc</p><li><a href="/c/1">Ch 1</a></li><li><a href="/c/2">Ch 2</a></li>',
    "https://p.test/c/1": '<img src="/1.jpg"><img src="/2.jpg">',
  };
  const seen: string[] = [];
  const h = {
    ...host,
    fetch: async (url: string, init: { headers: Record<string, string> }) => (
      seen.push(`${url} ${Object.keys(init.headers).join("+")}`), { status: pages[url] ? 200 : 404, url, headers: {}, body: new TextEncoder().encode(pages[url] ?? "") }
    ),
  } as Host;
  class Fake extends ParsedHttpSource {
    popularMangaRequest(page: number) {
      return GET(`${this.baseUrl}/popular?page=${page}`, this.headers);
    }
    popularMangaSelector() {
      return "div.m";
    }
    popularMangaFromElement(e: El) {
      return Object.assign(SManga.create(), { url: e.selectFirst("a")!.attr("href"), title: e.text() });
    }
    popularMangaNextPageSelector() {
      return "a.next";
    }
    latestUpdatesRequest = this.popularMangaRequest;
    latestUpdatesSelector = this.popularMangaSelector;
    latestUpdatesFromElement = this.popularMangaFromElement;
    latestUpdatesNextPageSelector() {
      return null;
    }
    searchMangaRequest = this.popularMangaRequest;
    searchMangaSelector = this.popularMangaSelector;
    searchMangaFromElement = this.popularMangaFromElement;
    searchMangaNextPageSelector = this.latestUpdatesNextPageSelector;
    mangaDetailsParse(d: El) {
      return Object.assign(SManga.create(), { description: d.selectFirst("p.d")!.text() });
    }
    chapterListSelector() {
      return "li";
    }
    chapterFromElement(e: El) {
      return Object.assign(SChapter.create(), { url: e.selectFirst("a")!.attr("href"), name: e.text() });
    }
    pageListParse(d: El) {
      return d.select("img").map((e, i) => new Page(i, "", e.absUrl("src")));
    }
    imageUrlParse() {
      return "";
    }
  }
  const src = new Fake(h, { id: "t", pkg: "t", name: "T", lang: "en", baseUrl: "https://p.test", contentWarning: "SAFE", version: "1", upstreamVersionCode: 1 });
  const popular = await src.getPopularManga(1);
  eq(popular.mangas.map((m) => m.title).join(","), "A,B");
  eq(popular.hasNextPage, true, "next page selector");
  eq((await src.getLatestUpdates(1)).hasNextPage, false, "null next page selector");
  const upd = await src.fetchMangaUpdate(popular.mangas[0], [], true, true);
  eq(`${upd.manga.url} ${upd.manga.title} ${upd.manga.description} ${upd.manga.initialized}`, "/m/a A desc true", "details merge keeps url and title");
  eq(upd.chapters.map((c) => c.url).join(","), "/c/1,/c/2");
  eq((await src.getPageList(upd.chapters[0])).map((p) => p.imageUrl).join(","), "https://p.test/1.jpg,https://p.test/2.jpg");
  eq(src.getMangaUrl(upd.manga), "https://p.test/m/a");
  eq(seen[0], "https://p.test/popular?page=1 user-agent", "1.4 headers: User-Agent only");
  await assert.rejects(src.getPageList(upd.chapters[1]), /HTTP error 404/, "asObservableSuccess");
  n++;
}

{
  const r = new Response({} as Host, { status: 404, url: "https://x.test/a.jpg", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) }).withCode(200);
  eq(`${r.code} ${r.isSuccessful} ${r.header("content-type")} ${r.bytes().length}`, "200 true image/jpeg 1", "Response.withCode");
}
{
  const { Filter, firstInstanceOrNull } = await import("../sdk/filters.ts");
  class A extends Filter.Text {}
  const fs = [new Filter.Header("h"), new A("a")];
  eq(firstInstanceOrNull(fs, A)?.name, "a", "firstInstanceOrNull");
  eq(firstInstanceOrNull(fs, Filter.CheckBox), null, "firstInstanceOrNull miss");
}

eq(urlWithoutDomain("https://a.test/c/1#"), "/c/1#", "empty fragment kept, as java.net.URI");
eq(urlWithoutDomain("https://a.test/c/1?x=1#5"), "/c/1?x=1#5");

// --- Instant.tryParse and Next.js flight data
eq(tryParseInstant("2024-05-01T10:00:00.000+07:00"), utc(2024, 5, 1, 3, 0));
eq(tryParseInstant("2024-05-01T10:00:00Z"), utc(2024, 5, 1, 10, 0));
eq(tryParseInstant("2024-05-01"), 0, "no time, no instant");
eq(tryParseInstant("2026-03-20T12:18:04+00"), utc(2026, 3, 20, 12, 18, 4), "bare ±hh offset");
const rsc = '0:["$","div",null,{"children":"$L1"}]\n1:{"series":{"title":"A","when":"$D2024-01-01"},"chapters":"$2"}\n2:[{"id":"c1"}]\n';
const hit = extractNextJsRsc<{ series: { title: string; when: string }; chapters: { id: string }[] }>(rsc, hasKeys("series", "chapters"));
eq(hit?.series.title, "A");
eq(hit?.series.when, "2024-01-01", "$D date marker");
eq(hit?.chapters[0].id, "c1", "outlined model reference");
const flightDoc = parseHtml(load, `<script>self.__next_f.push([1,${JSON.stringify(rsc)}])</script>`, "https://a.test/");
eq(extractNextJsFromDocument<{ chapters: unknown[] }>(flightDoc, hasKeys("series", "chapters"))?.chapters.length, 1, "App Router script");

// --- parseAsProto
{
  const inner: ProtoSchema = { 1: ["id", "int"], 2: ["name", "string"] };
  const p = decodeProto<{ a: { id: number; name: string }; ns: number[]; missing?: string }>(
    Uint8Array.from([0x0a, 0x07, 0x08, 0x96, 0x01, 0x12, 0x02, 0x68, 0x69, 0x18, 0x05, 0x4d, 0, 0, 0, 0, 0x18, 0x7f]),
    { 1: ["a", { ...inner }], 3: ["ns", "int", true], 4: ["missing", "string"] },
  );
  eq(`${p.a.id} ${p.a.name} ${p.ns.join(",")} ${p.missing}`, "150 hi 5,127 undefined", "protobuf: nested, repeated, unknown fixed32 skipped");
  const r = new Response({} as Host, { status: 200, url: "https://x.test/a", headers: {}, body: new Uint8Array([1]) }).withBody(new Uint8Array([2, 3]));
  eq(r.bytes().join(","), "2,3", "Response.withBody");
  eq(new Response({} as Host, { status: 200, url: "https://x.test/a", headers: { "content-type": "text/html; charset=UTF-8mb4" }, body: new TextEncoder().encode("é") }).text(), "é", "Response.text: unsupported charset falls back to UTF-8");
  const d = parseHtml(load, `<section x-data="{ scrollDown() {} }"><img src=a></section><img alt="Coin icon" src=b><a rel="x (sponsored)">`, "https://a.test/");
  eq(d.select("section[x-data~=scroll] > img").length, 1, "Jsoup [attr~=regex] is a regex find");
  eq(d.select("img[alt~=Coin]").attr("src"), "b");
  eq(d.select("a[rel~=\\(spon]").length, 1, "regex with a paren");
  const fl = [new Filter.Header("h"), new Filter.Text("t", "x")];
  eq(`${firstInstance(fl, Filter.Text).state} ${firstInstanceOrNull(fl, Filter.CheckBox)}`, "x null", "firstInstance");
  assert.throws(() => firstInstance(fl, Filter.Sort));
}

{
  // keiyoushi.zip: a two-entry archive (stored + deflated) read back through the directory and local headers
  const { deflateRawSync } = await import("node:zlib");
  const { readZipDirectory, readEntry, dataRange } = await import("../sdk/zip.ts");
  const le = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >>> (8 * i)) & 0xff);
  const files = [["b.txt", new TextEncoder().encode("hello"), 0], ["a.txt", new TextEncoder().encode("world world world"), 8]] as const;
  const local: number[] = [], cd: number[] = [];
  for (const [name, raw, method] of files) {
    const data = method ? [...deflateRawSync(raw)] : [...raw];
    const nm = [...new TextEncoder().encode(name)];
    const off = local.length;
    local.push(...le(0x04034b50, 4), ...le(0, 4), ...le(method, 2), ...le(0, 8), ...le(data.length, 4), ...le(raw.length, 4), ...le(nm.length, 2), ...le(0, 2), ...nm, ...data);
    cd.push(...le(0x02014b50, 4), ...le(0, 6), ...le(method, 2), ...le(0, 8), ...le(data.length, 4), ...le(raw.length, 4), ...le(nm.length, 2), ...le(0, 12), ...le(off, 4), ...nm);
  }
  const zip = Uint8Array.from([...local, ...cd, ...le(0x06054b50, 4), ...le(0, 4), ...le(2, 2), ...le(2, 2), ...le(cd.length, 4), ...le(local.length, 4), ...le(0, 2)]);
  const dir = await readZipDirectory(zip, zip.length, () => Promise.reject(new Error("no fetch")));
  const out = await Promise.all(dir.entries.map((e) => { const [a, b] = dataRange(e.localHeaderOffset, e.compressedSize); return readEntry(zip.slice(a, b + 1), e.compressedSize, e.method); }));
  eq(dir.entries.map((e, i) => `${e.name}=${new TextDecoder().decode(out[i])}`).join(" "), "b.txt=hello a.txt=world world world", "zip: stored + deflate entries");
}

// --- libs/ (keiyoushi.lib.*)
{
  const { TextInterceptor, TextInterceptorHelper } = await import("../libs/textinterceptor/index.ts");
  const run = (url: string) => TextInterceptor()({ request: () => ({ url, method: "GET", headers: new Headers() }), proceed: async () => Response.of(url, new Uint8Array(), null, 204) });
  const url = TextInterceptorHelper.createUrl("Notes <script>&", "a < b & c > <script>alert(1)</script> " + "lorem ipsum dolor ".repeat(40));
  eq(url.startsWith("http://tachiyomi-lib-textinterceptor/Notes%20%3Cscript%3E%26/a%20"), true, "createUrl encodes like Uri.encode");
  const r = await run(url);
  const svg = r.text();
  eq(r.header("content-type"), "image/svg+xml");
  eq(/<script|<a[\s>]|href|url\(/i.test(svg), false, "no script, link or external reference");
  eq(svg.includes("Notes &amp;"), true, "heading text escaped");
  eq(svg.includes("a &lt; b &amp; c &gt;"), true, "body text escaped");
  eq((svg.match(/<tspan/g) ?? []).length > 5, true, "long text wraps");
  eq((await run("https://x.test/a.jpg")).code, 204, "other hosts proceed");
}
{
  const { DataImageInterceptor, dataImageAsUrl } = await import("../libs/dataimage/index.ts");
  const doc = parseHtml(load, `<img src="data:image/png;base64,AQID"><img src="/b.png">`, "https://a.test/c/");
  const [u1, u2] = doc.select("img").map((e) => dataImageAsUrl(e, "src"));
  eq(`${u1} ${u2}`, "https://127.0.0.1/?image/png;base64,AQID https://a.test/b.png");
  const r = await DataImageInterceptor()({ request: () => ({ url: u1, method: "GET", headers: new Headers() }), proceed: () => Promise.reject(new Error("network")) });
  eq(`${r.header("content-type")} ${[...r.bytes()].join(",")}`, "image/png 1,2,3", "data image decoded");
}
{
  const { CryptoAES, Deobfuscator } = await import("../libs/cryptoaes/index.ts");
  eq(await CryptoAES.decrypt("U2FsdGVkX18BAgMEBQYHCETIDS2uqZjeUiEyFasaDpU=", "pw"), "hello world", "CryptoAES password (EVP_BytesToKey)");
  eq(await CryptoAES.decrypt("iPuG2Z2M6Cv8cPyZ869U9g==", new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)), "raw key", "CryptoAES key + iv");
  eq(await CryptoAES.decrypt("U2FsdGVkX18BAgMEBQYHCETIDS2uqZjeUiEyFasaDpU=", "wrong"), "", "bad password -> empty");
  eq(Deobfuscator.deobfuscateJsPassword("[+[]]+[!+[]+!+[]]+(+[])[+[]]+[!+[]]"), "02.1", "JSFuck digits");
}
{
  const { Intl: LibIntl } = await import("../libs/i18n/index.ts");
  const intl = new LibIntl({ language: "id", baseLanguage: "en", availableLanguages: ["en", "id"], messages: { en: { a: "A", b: "B %s" }, id: { a: "Ai" } } });
  eq(`${intl.get("a")} ${intl.format("b", 1)} ${intl.get("c")}`, "Ai B 1 [c]");
  eq(intl.languageDisplayName("en"), "Inggris", "display name in the chosen language, capitalised");
  eq(LibIntl.createDefaultMessageFileName("pt-BR"), "assets/i18n/messages_pt_br.properties");
}
{
  const { setRandomUserAgent, UserAgentType } = await import("../libs/randomua/index.ts");
  const { SharedPreferences } = await import("../sdk/preferences.ts");
  const store = new Map<string, unknown>([["pref_key_custom_ua_", "Custom/1.0"]]);
  const prefs = new SharedPreferences({ get: (k) => store.get(k), set: (k, v) => void store.set(k, v) });
  prefs.edit().putLong("l", 1_700_000_000_000).apply();
  eq(prefs.getLong("l", 0), 1_700_000_000_000, "putLong/getLong round-trip");
  let fetched = 0;
  const host = { load, userAgent: "UA", prefs: { get: () => undefined, set() {} }, fetch: async (url: string) => (fetched++, { status: 200, url, headers: { "content-type": "application/json" }, body: utf8('{"desktop":["Chrome D","Firefox D"],"mobile":["Chrome M"]}') }) } as Host;
  const client = new HttpClient(host, () => new Headers(), new ClientBuilder());
  eq(setRandomUserAgent(new Headers({ "User-Agent": "x" }), prefs, client).get("User-Agent"), "Custom/1.0", "custom UA when random is off");
  eq(setRandomUserAgent(new Headers({ "User-Agent": "x" }), prefs, client, UserAgentType.DESKTOP, ["chrome"]).get("User-Agent"), "x", "first call starts the download");
  await new Promise((r) => setTimeout(r, 10));
  eq(setRandomUserAgent(new Headers({ "User-Agent": "x" }), prefs, client, UserAgentType.DESKTOP, ["chrome"]).get("User-Agent"), "Chrome D", "filtered random UA once loaded");
  eq(fetched, 1);
}
{
  const { rc4, inflate } = await import("../sdk/crypto.ts");
  eq(toHex(rc4(utf8("Plaintext"), utf8("Key"))), "bbf316e8d940af0ad3", "RC4 test vector");
  eq(toHex(rc4(rc4(utf8("abc"), utf8("k"), 769), utf8("k"), 769)), toHex(utf8("abc")), "RC4 with skip is symmetric");
  eq((await inflate(Uint8Array.from([0x78, 0x9c, 0x4b, 0x04, 0x00, 0x00, 0x62, 0x00, 0x62]))).length, 1, "zlib inflate");
  const { blake2b256, E4PInterceptor, TiffDecoder, QscArchive } = await import("../libs/e4p/index.ts");
  eq(toHex(blake2b256(new Uint8Array(0))), "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8", "BLAKE2b-256 of empty input");
  // QSC archive: 4096-byte directory, one entry "p1" holding a RIFF with trailing junk that stripToWebp cuts
  const webp = Uint8Array.from([...utf8("RIFF"), 0, 0, 0, 0, ...utf8("XEBPVP8 "), 2, 0, 0, 0, 7, 8, 99, 99]);
  const archive = new Uint8Array(QscArchive.DIR_SIZE + webp.length);
  archive.set([0x45, 0x34, 0x50, 0x51, 0x53, 0x43, 1, 0]);
  archive.set([...utf8("RIFF"), webp.length, 0, 0, 0, ...utf8("p1")], 32);
  archive.set(webp, QscArchive.DIR_SIZE);
  const ranges: string[] = [];
  const proceed = async (req: { url: string; headers: Headers }) => {
    const [a, b] = req.headers.get("Range")!.slice(6).split("-").map(Number);
    ranges.push(`${a}-${b}`);
    return Response.of(req.url, archive.slice(a, b + 1), "application/octet-stream", 206);
  };
  const r = await E4PInterceptor()({ request: () => ({ url: "https://e.test/a.qsc#p1", method: "GET", headers: new Headers() }), proceed });
  eq(`${ranges.join(" ")} ${r.code} ${r.header("content-type")} ${toHex(r.bytes())}`, `0-4095 4096-4119 200 image/webp ${toHex(Uint8Array.from([...utf8("RIFF"), 14, 0, 0, 0, ...utf8("WEBPVP8 "), 2, 0, 0, 0, 7, 8]))}`, "E4P: QSC entry by Range, stripped to WebP");
  // 2x1 RGB TIFF, uncompressed, horizontal predictor
  const ifd = [[256, 3, 1, 2], [257, 3, 1, 1], [258, 3, 1, 8], [262, 3, 1, 2], [273, 4, 1, 8], [277, 3, 1, 3], [279, 4, 1, 6], [317, 3, 1, 2]];
  const tiff = new Uint8Array(14 + 2 + ifd.length * 12);
  const tv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0], 0);
  tv.setUint32(4, 14, true);
  tiff.set([10, 20, 30, 5, 5, 5], 8);
  tv.setUint16(14, ifd.length, true);
  ifd.forEach(([tag, type, count, value], i) => (tv.setUint16(16 + i * 12, tag, true), tv.setUint16(18 + i * 12, type, true), tv.setUint32(20 + i * 12, count, true), tv.setUint32(24 + i * 12, value, true)));
  eq([...TiffDecoder.decode(tiff).pixels].map((p) => p.toString(16)).join(","), "ff0a141e,ff0f1923", "TIFF RGB + predictor");
}

{
  const { graphQLBody, parseGraphQLAs, GraphQLException } = await import("../sdk/json.ts");
  eq(graphQLBody({ query: "q", variables: { a: 1, b: null } }), '{"query":"q","variables":{"a":1}}', "graphQLBody drops nulls");
  eq(parseGraphQLAs<{ x: number }>('{"data":{"x":2}}').x, 2, "parseGraphQLAs data");
  assert.throws(() => parseGraphQLAs('{"errors":[{"message":"bad"}]}'), GraphQLException);
}
{
  const { hmacSha256 } = await import("../sdk/crypto.ts");
  // RFC 4231 test case 2
  eq(toHex(await hmacSha256("Jefe", "what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", "hmacSha256");
}

{
  const { aesCbcDecryptNoPadding, hexBytes } = await import("../sdk/crypto.ts");
  // NIST SP 800-38A F.2.2 CBC-AES128.Decrypt, first two blocks (no padding)
  const plain = await aesCbcDecryptNoPadding(hexBytes("2b7e151628aed2a6abf7158809cf4f3c"), hexBytes("000102030405060708090a0b0c0d0e0f"), hexBytes("7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2ff"));
  eq(toHex(plain), "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51", "aesCbcDecryptNoPadding");
}

{
  // sdk/image.ts: draws are recorded as layers, clipped to the canvas; a host without `image` fails clearly
  const { Canvas, imageSize } = await import("../sdk/image.ts");
  const { sharpImage } = await import("./node-host.ts");
  const bare = { userAgent: "", load, prefs: { get: () => undefined, set() {} }, fetch: async () => ({ status: 200, url: "", headers: {}, body: new Uint8Array() }) } satisfies Host;
  assert.throws(() => new Canvas(bare, 1, 1), /Host\.image is missing/);
  await assert.rejects(imageSize(bare, new Uint8Array()), /Host\.image is missing/);
  let got: unknown;
  const fake: Host = { ...bare, image: { size: async () => ({ width: 0, height: 0 }), compose: async (o) => ((got = o), new Uint8Array([1])) } };
  const b = new Uint8Array([9]);
  const c = new Canvas(fake, 10, 10);
  c.drawImage(b, 0, 0, 4, 4, -1, 8); // clipped left and bottom
  c.drawImage(b, 0, 0, 4, 4, 10, 0); // fully outside: dropped
  eq((await c.encode("jpeg", 90))[0], 1);
  assert.deepEqual(got, { width: 10, height: 10, format: "jpeg", quality: 90, layers: [{ bytes: b, sx: 1, sy: 0, sw: 3, sh: 2, dx: 0, dy: 8 }] });
  n++;

  // sharp host: swap the two halves of a 4x2 image (left red, right blue), losslessly as PNG
  const sharp = (await import("sharp")).default;
  const row = [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255];
  const src = new Uint8Array(await sharp(Buffer.from([...row, ...row]), { raw: { width: 4, height: 2, channels: 4 } }).png().toBuffer());
  const host: Host = { ...bare, image: sharpImage };
  eq(JSON.stringify(await imageSize(host, src)), '{"width":4,"height":2}');
  const s = new Canvas(host, 4, 2);
  s.drawImage(src, 2, 0, 2, 2, 0, 0);
  s.drawImage(src, 0, 0, 2, 2, 2, 0);
  const out = await sharp(await s.encode("png")).raw().toBuffer();
  eq([...out.subarray(0, 4)].join(), "0,0,255,255", "blue moved left");
  eq([...out.subarray(12, 16)].join(), "255,0,0,255", "red moved right");
  // drawImageTransformed: mirror then rotate CCW, centred; a 2x1 [red, blue] tile mirrored is [blue, red], turned 90deg CCW it reads top-down [red, blue]
  const t = new Canvas(host, 1, 2);
  t.drawImageTransformed(src, 1, 0, 2, 1, 0.5, 1, 1, true);
  const tout = await sharp(await t.encode("png")).raw().toBuffer();
  eq([...tout].join(), "255,0,0,255,0,0,255,255", "mirror + rotate 90 CCW");
  const jpeg = await new Canvas(host, 2, 2).encode("jpeg");
  eq([...(await sharp(jpeg).raw().toBuffer()).subarray(0, 3)].join(), "0,0,0", "blank JPEG canvas is black");
}

console.log(`sdk: ${n} checks passed`);
