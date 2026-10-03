// Port of keiyoushi/extensions-source src/en/madokami/Madokami.kt
import {
  Base64,
  DateTimeFormatter,
  EditTextPreference,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ZoneOffset,
  dataRange,
  escapeRegex,
  parseAs,
  readEntry,
  str,
  substringAfter,
  substringBeforeLast,
  toHttpUrl,
  toHttpUrlOrNull,
  zipDirectory,
  type Chain,
  type ClientBuilder,
  type Document,
  type Element,
  type HttpUrl,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

const PREF_USERNAME_KEY = "username";
const PREF_PASSWORD_KEY = "password";
const PREF_PREFER_UPLOAD_DATE_KEY = "prefer_upload_date";
const PREF_METADATA_WORDS_KEY = "metadata_words";

const ARCHIVE_EXTENSIONS = [".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7", ".tar", ".cbt"];
const UNSUPPORTED_EXTENSIONS = [".epub", ".pdf", ".txt"];
const VOLUME_REGEX = /\b(?:v|vol)(?:\.|ume)?\s?(\d+(?:[.\-x]\d+)*)\b/i;
const CHAPTER_REGEX = /\b(?:c|ch)(?:\.|apter)?\s?(\d+(?:[.\-x]\d+)*)\b/i;
const RAW_NUMBER_REGEX = /\b(\d+(?:[.\-x]\d+)*)\b/g;
const METADATA_REGEX = /[[(]([^\])]+)[\])]/g;
const YEAR_REGEX = /^(?:\b(19|20)\d{2}\b)$/;
const FIX_REGEX = /^(?:f\d*)$/i;
const METADATA_WORDS_REGEX = /\b(?:end|digital|dig|omnibus|edition|pre|magazine|raws?|na|web)\b/i;

const endsWithIgnoreCase = (s: string, suffix: string) => s.toLowerCase().endsWith(suffix);
/** String.replace with a Kotlin Regex over every match (the constants above carry the g flag where findAll is used). */
const replaceAll = (s: string, re: RegExp, to: string) => s.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), to);

/** net.greypanther.natsort.CaseInsensitiveSimpleNaturalComparator: digit runs compare by value, the rest case-insensitively. */
function naturalCompare(a: string, b: string): number {
  const chunks = (s: string) => s.toLowerCase().match(/\d+|\D+/g) ?? [];
  const x = chunks(a);
  const y = chunks(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (/^\d/.test(x[i]) && /^\d/.test(y[i])) {
      const p = x[i].replace(/^0+/, "");
      const q = y[i].replace(/^0+/, "");
      if (p.length !== q.length) return p.length < q.length ? -1 : 1;
      if (p !== q) return p < q ? -1 : 1;
      continue;
    }
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

interface ChapterInfo {
  name: string;
  scanlator: string | null;
  year: string | null;
}

export default class Madokami extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly dateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT);

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor(async (chain) => {
        const headers = new Headers(chain.request().headers);
        headers.set("Authorization", this.getAuthCredential());
        const response = await chain.proceed({ ...chain.request(), headers });
        if (response.code === 401) throw new Error("You are currently logged out.\nGo to Extensions > Details to input your credentials.");
        return response;
      })
      .addChainInterceptor((chain) => this.zipRangeInterceptor(chain));
  }

  private async zipRangeInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const url = toHttpUrl(request.url);
    const fragment = url.fragment;

    if (fragment != null && (endsWithIgnoreCase(url.encodedPath, ".zip") || endsWithIgnoreCase(url.encodedPath, ".cbz"))) {
      // HttpUrl.fragment is percent-decoded upstream; getZipPageList encodes it below
      const parts = decodeURIComponent(fragment).split("|");
      if (parts.length === 4) {
        const zipUrl = url.newBuilder().fragment(null).build().toString();
        const name = parts[0];
        const method = Number.parseInt(parts[1], 10);
        const compressedSize = Number.parseInt(parts[2], 10);
        const localHeaderOffset = Number.parseInt(parts[3], 10);

        // client.readZipEntry(zipUrl, entry, request.headers): a range request for the entry's data
        const [first, last] = dataRange(localHeaderOffset, compressedSize);
        const headers = new Headers(request.headers);
        headers.set("Range", `bytes=${first}-${last}`);
        const response = await chain.proceed({ ...request, url: zipUrl, headers });
        if (!response.isSuccessful) return response;
        const source = await readEntry(response.bytes(), compressedSize, method);
        return Response.of(request.url, source, this.getMediaType(name));
      }
    }
    return chain.proceed(request);
  }

  private getAuthCredential(): string {
    const username = this.preferences.getString(PREF_USERNAME_KEY, "")!;
    const password = this.preferences.getString(PREF_PASSWORD_KEY, "")!;

    if (!username.trim() || !password.trim()) throw new Error("Username or password cannot be empty.\nGo to Extensions > Details to input your credentials.");

    // Credentials.basic: ISO-8859-1
    return `Basic ${Base64.encode(Uint8Array.from(`${username}:${password}`, (c) => c.charCodeAt(0) & 0xff))}`;
  }

  private getAuthHeaders(): Headers {
    const h = this.headers;
    h.set("Authorization", this.getAuthCredential());
    return h;
  }

  private get customMetadataRegex(): RegExp | null {
    const raw = this.preferences.getString(PREF_METADATA_WORDS_KEY, "") ?? "";
    if (!raw.trim()) return null;
    const words = raw
      .split(",")
      .map((it) => it.trim())
      .filter((it) => it.length > 0);
    return words.length === 0 ? null : new RegExp(`\\b(?:${words.map((it) => escapeRegex(it)).join("|")})\\b`, "i");
  }

  private getMediaType(name: string): string {
    if (endsWithIgnoreCase(name, ".png")) return "image/png";
    if (endsWithIgnoreCase(name, ".webp")) return "image/webp";
    if (endsWithIgnoreCase(name, ".gif")) return "image/gif";
    if (endsWithIgnoreCase(name, ".avif")) return "image/avif";
    return "image/jpeg";
  }

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/recent`);
    const document = response.asJsoup();
    const mangas = document
      .select("table.mobile-files-table tbody tr td:nth-child(1) a:nth-child(1)")
      .map((element) => this.mangaFromElement(element))
      .filter((it): it is SManga => it !== null);
    return new MangasPage(mangas, false);
  }

  override getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  override async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const lower = query.toLowerCase();
    let url: HttpUrl;
    if (lower.startsWith("genre:") || lower.startsWith("genres:")) {
      url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment("genre").addPathSegment(substringAfter(query, ":").trim()).build();
    } else if (lower.startsWith("category:") || lower.startsWith("tags:") || lower.startsWith("tag:")) {
      url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment("category").addPathSegment(substringAfter(query, ":").trim()).build();
    } else {
      url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("q", query).build();
    }

    const response = await this.client.get(url.toString());
    const document = response.asJsoup();
    const mangas = document
      .select("div.container table tbody tr td:nth-child(1) a:nth-child(1), table.mobile-files-table tbody tr td:nth-child(1) a:nth-child(1)")
      .map((element) => this.mangaFromElement(element))
      .filter((it): it is SManga => it !== null);
    return new MangasPage(mangas, false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    if (this.isArchiveUrl(url.href)) return null;

    const manga = SManga.create();
    manga.url = url.pathname;

    try {
      return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    } catch {
      return null;
    }
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const detailsUrl = this.getMangaDetailsUrl(manga);
    const chaptersUrl = toHttpUrl(`${this.baseUrl}/${manga.url.replace(/^\/+/, "")}`);

    const response = await this.client.get(detailsUrl.toString());
    const document = response.asJsoup();
    const related = this.parseRelatedManga(document, detailsUrl.toString());

    if (detailsUrl.toString() !== chaptersUrl.toString()) {
      const m = this.mangaFromHttpUrl(detailsUrl);
      if (m) related.push(m);
    }

    let current = chaptersUrl;
    while (current.pathSegments.length > detailsUrl.pathSegments.length) {
      current = current
        .newBuilder()
        .removePathSegment(current.pathSegments.length - 1)
        .build();
      if (current.toString() !== detailsUrl.toString()) {
        const m = this.mangaFromHttpUrl(current);
        if (m) related.push(m);
      }
    }

    return this.distinctByUrl(related);
  }

  private distinctByUrl(list: SManga[]): SManga[] {
    const seen = new Set<string>();
    return list.filter((it) => !seen.has(it.url) && (seen.add(it.url), true));
  }

  private mangaFromElement(element: Element): SManga | null {
    return this.mangaFromUrl(element.absUrl("href"));
  }

  private mangaFromUrl(url: string): SManga | null {
    if (!url) return null;
    const httpUrl = toHttpUrlOrNull(url);
    if (!httpUrl) return null;
    return this.mangaFromHttpUrl(httpUrl);
  }

  private mangaFromHttpUrl(url: HttpUrl): SManga | null {
    if (this.isArchiveUrl(url.toString())) return null;
    const segments = url.pathSegments;
    if (segments.length === 0) return null;

    const manga = SManga.create();
    manga.url = url.encodedPath;
    manga.description = segments[segments.length - 1];
    let i = segments.length - 1;
    while (i > 0 && segments[i].startsWith("!")) i--;
    manga.title = segments[i];
    return manga;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const detailsUrl = this.getMangaDetailsUrl(manga);
    const chaptersUrl = toHttpUrl(`${this.baseUrl}/${manga.url.replace(/^\/+/, "")}`);

    if (fetchDetails && fetchChapters && detailsUrl.toString() === chaptersUrl.toString()) {
      const document = (await this.client.get(detailsUrl.toString())).asJsoup();
      const details = this.parseMangaDetails(document);
      details.url = manga.url;
      details.initialized = true;
      return new SMangaUpdate(details, this.parseChapterList(document));
    }

    const [details, parsedChapters] = await Promise.all([
      fetchDetails ? this.client.get(detailsUrl.toString()).then((it) => this.parseMangaDetails(it.asJsoup())) : null,
      fetchChapters ? this.client.get(chaptersUrl.toString()).then((it) => this.parseChapterList(it.asJsoup())) : null,
    ]);

    let updatedManga = manga;
    if (details) {
      details.url = manga.url;
      details.initialized = true;
      updatedManga = details;
    }

    return new SMangaUpdate(updatedManga, parsedChapters ?? chapters);
  }

  private getMangaDetailsUrl(manga: SManga): HttpUrl {
    const url = toHttpUrl(`${this.baseUrl}/${manga.url.replace(/^\/+/, "")}`);
    const segments = url.pathSegments;
    if (segments.length > 5 && segments[0] === "Manga" && segments[1].length === 1) {
      const builder = url.newBuilder();
      for (let n = 0; n < segments.length - 5; n++) builder.removePathSegment(5);
      return builder.build();
    }
    if (segments.length > 2 && segments[0] === "Raws") {
      const builder = url.newBuilder();
      let i = segments.length - 1;
      while (segments[i].startsWith("!") && i >= 2) {
        builder.removePathSegment(i);
        i--;
      }
      return builder.build();
    }
    return url;
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.author = document
      .select('a[itemprop="author"]')
      .map((it) => it.text())
      .join(", ");
    const genres = document.select('div.genres a[itemprop="genre"]').map((it) => `Genres:${it.text()}`);
    const categories = document.select('div.genres[itemprop="keywords"] a.tag-category').map((it) => `Tags:${it.text()}`);
    manga.genre = [...genres, ...categories].join(", ");
    manga.status = document.select("span.scanstatus").text() === "Yes" ? SManga.COMPLETED : SManga.UNKNOWN;
    manga.thumbnail_url = document.select('div.manga-info img[itemprop="image"]').attr("abs:src");
    return manga;
  }

  private parseRelatedManga(document: Document, url: string): SManga[] {
    const related: SManga[] = [];

    for (const element of document.select("table#index-table tbody tr td:nth-child(1) a")) {
      const href = element.absUrl("href");
      if (!href || href === url || this.isArchiveUrl(href) || element.text() === "..") continue;
      const m = this.mangaFromUrl(href);
      if (m) related.push(m);
    }

    for (const element of document.select('div.manga-info a[href*="/Manga/"], div.manga-info a[href*="/Raws/"]')) {
      const href = element.absUrl("href");
      if (!href || href === url || this.isArchiveUrl(href)) continue;
      const m = this.mangaFromUrl(href);
      if (m) related.push(m);
    }

    return this.distinctByUrl(related);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${manga.url.replace(/^\/+/, "")}`;
  }

  private parseChapterList(document: Document): SChapter[] {
    const out: SChapter[] = [];
    for (const row of document.select("table#index-table > tbody > tr")) {
      const fileLink = row.selectFirst("td:nth-child(1) a");
      if (!fileLink) continue;
      const fileName = fileLink.text();
      const readerLink = row.selectFirst("td:nth-child(6) a");

      if (!this.isSupportedChapter(fileName, readerLink)) continue;

      const { name: formattedName, scanlator: scanlatorName, year } = this.extractInfo(fileName);

      const isZipOrCbz = endsWithIgnoreCase(fileName, ".zip") || endsWithIgnoreCase(fileName, ".cbz");

      const chapter = SChapter.create();
      chapter.url = isZipOrCbz || readerLink === null ? substringAfter(fileLink.absUrl("href"), this.baseUrl) : `/reader${substringAfter(readerLink.absUrl("href"), "/reader")}`;
      chapter.name = formattedName;
      chapter.scanlator = scanlatorName ?? undefined;

      const tableDate = this.parseChapterDate(row.select("td:nth-child(3)").text());
      const fileDate = year != null ? Date.UTC(Number.parseInt(year, 10), 0, 1) : 0;

      chapter.date_upload = this.preferences.getBoolean(PREF_PREFER_UPLOAD_DATE_KEY, false) ? (tableDate !== 0 ? tableDate : fileDate) : fileDate !== 0 ? fileDate : tableDate;
      out.push(chapter);
    }
    return out.reverse();
  }

  private isSupportedChapter(fileName: string, readerLink: Element | null): boolean {
    const isZipOrCbz = endsWithIgnoreCase(fileName, ".zip") || endsWithIgnoreCase(fileName, ".cbz");
    const isUnsupported = UNSUPPORTED_EXTENSIONS.some((it) => endsWithIgnoreCase(fileName, it));

    return isZipOrCbz || (readerLink !== null && !isUnsupported);
  }

  private extractInfo(name: string): ChapterInfo {
    const fileName = substringBeforeLast(name, ".").replaceAll("_", " ");
    const volMatch = VOLUME_REGEX.exec(fileName);
    const chMatch = CHAPTER_REGEX.exec(fileName);

    const vol = volMatch?.[1]?.replaceAll("x", ".") ?? null;
    const ch = chMatch?.[1]?.replaceAll("x", ".") ?? null;

    let baseName: string;
    if (ch != null && vol != null) baseName = `Ch. ${ch} (Vol. ${vol})`;
    else if (ch != null) baseName = `Ch. ${ch}`;
    else if (vol != null) baseName = `Vol. ${vol}`;
    else {
      const fileNameNoTags = replaceAll(fileName, METADATA_REGEX, " ");
      const rawMatch = [...fileNameNoTags.matchAll(RAW_NUMBER_REGEX)].at(-1);
      baseName = rawMatch ? `Ch. ${rawMatch[1].replaceAll("x", ".")}` : fileName;
    }

    const allTags = [...fileName.matchAll(METADATA_REGEX)].map((it) => it[1]);
    const scanlators: string[] = [];
    const infoTags: string[] = [];
    let foundYear: string | null = null;

    for (const tag of allTags) {
      const lowerTag = tag.toLowerCase();

      const tagVol = VOLUME_REGEX.exec(tag)?.[1]?.replaceAll("x", ".") ?? null;
      const tagCh = CHAPTER_REGEX.exec(tag)?.[1]?.replaceAll("x", ".") ?? null;
      if ((tagVol != null && tagVol === vol) || (tagCh != null && tagCh === ch)) continue;

      if (FIX_REGEX.test(lowerTag)) {
        infoTags.push(`(${tag})`);
        continue;
      }

      if (YEAR_REGEX.test(tag)) {
        foundYear = tag;
        continue;
      }

      if (METADATA_WORDS_REGEX.test(lowerTag) || this.customMetadataRegex?.test(lowerTag) === true) {
        infoTags.push(`(${tag})`);
        continue;
      }

      scanlators.push(tag);
    }

    const scanlatorString = scanlators.length > 0 ? scanlators.join(", ") : null;
    const infoString = infoTags.length > 0 ? infoTags.join(" ") : null;

    const finalName = infoString != null ? `${baseName} ${infoString}` : baseName;

    return { name: finalName, scanlator: scanlatorString, year: foundYear };
  }

  private parseChapterDate(dateString: string): number {
    if (dateString.endsWith("ago")) {
      const splitDate = dateString.split(" ");
      const amount = /^[+-]?\d+$/.test(splitDate[0]) ? Number.parseInt(splitDate[0], 10) : null;
      if (amount === null) return 0;
      const now = Date.now();
      if (splitDate[1].startsWith("min")) return now - amount * 60_000;
      if (splitDate[1].startsWith("sec")) return now - amount * 1000;
      if (splitDate[1].startsWith("hour")) return now - amount * 3_600_000;
      return now;
    }
    return this.dateTimeFormatter.tryParseDateTime(dateString, ZoneOffset.UTC);
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    if (endsWithIgnoreCase(chapter.url, ".zip") || endsWithIgnoreCase(chapter.url, ".cbz")) return this.getZipPageList(chapter);

    if (!chapter.url.startsWith("/")) throw new Error("Refresh chapter list");
    const response = await this.client.get(this.baseUrl + chapter.url);
    const document = response.asJsoup();
    const element = document.select("div#reader");
    const path = element.attr("data-path");
    const files = parseAs<unknown[]>(element.attr("data-files"));
    return files.map((file, index) => {
      const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments("reader/image").addQueryParameter("path", path).addQueryParameter("file", str(file) ?? "").build();
      const pageUrl = url.toString();
      return new Page(index, pageUrl, pageUrl);
    });
  }

  private async getZipPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.baseUrl + chapter.url;
    let directory;
    try {
      directory = await zipDirectory(this.client, url, this.getAuthHeaders());
    } catch (e) {
      if (e instanceof Error && e.message.includes("Content-Range")) throw new Error("Refresh episode list and try again", { cause: e });
      throw e;
    }

    return directory.entries
      .filter((it) => this.isImage(it.name))
      .sort((f1, f2) => naturalCompare(f1.name, f2.name))
      .map((entry, index) => {
        // Store entry metadata in fragment to avoid re-reading CD per page
        const fragment = encodeURIComponent(`${entry.name}|${entry.method}|${entry.compressedSize}|${entry.localHeaderOffset}`);
        const pageUrl = toHttpUrl(url).newBuilder().fragment(fragment).build().toString();
        return new Page(index, pageUrl, pageUrl);
      });
  }

  private isImage(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".avif");
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const username = new EditTextPreference(screen.context);
    username.key = PREF_USERNAME_KEY;
    username.title = "Username";
    screen.addPreference(username);

    const password = new EditTextPreference(screen.context);
    password.key = PREF_PASSWORD_KEY;
    password.title = "Password";
    screen.addPreference(password);

    const preferDate = new SwitchPreferenceCompat(screen.context);
    preferDate.key = PREF_PREFER_UPLOAD_DATE_KEY;
    preferDate.title = "Prefer Date Uploaded";
    preferDate.summary = "Defaults to use date from filename (Year)";
    preferDate.setDefaultValue(true);
    screen.addPreference(preferDate);

    const metadata = new EditTextPreference(screen.context);
    metadata.key = PREF_METADATA_WORDS_KEY;
    metadata.title = "Additional Metadata Words";
    metadata.summary = "Comma-separated list of words to treat as metadata instead of scanlators";
    screen.addPreference(metadata);
  }

  private isArchiveUrl(url: string): boolean {
    const httpUrl = toHttpUrlOrNull(url);
    if (!httpUrl) {
      const lower = url.toLowerCase();
      return ARCHIVE_EXTENSIONS.some((it) => lower.endsWith(it)) || UNSUPPORTED_EXTENSIONS.some((it) => lower.endsWith(it));
    }
    const path = httpUrl.encodedPath.toLowerCase();
    return ARCHIVE_EXTENSIONS.some((it) => path.endsWith(it)) || UNSUPPORTED_EXTENSIONS.some((it) => path.endsWith(it));
  }
}

