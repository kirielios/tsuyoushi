// Port of keiyoushi/extensions-source src/en/spyfakku/SpyFakku.kt
// Insecure TLS (trust-all X509TrustManager, hostnameVerifier) is up to the host's fetch and is not ported.
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneOffset, parseHtml, substringAfter, substringBefore, toHttpUrl, type ClientBuilder, type FilterList, type Response } from "../../../sdk/index.ts";
import { SelectFilter, SortFilter, TextFilter, getFilters } from "./filters.ts";

// ============================== Dto.kt ==============================
interface HentaiLib {
  archives: Hentai[];
  page: number;
  limit: number;
  total: number;
}
interface Hentai {
  id: number;
  hash: string;
  title: string;
  thumbnail: number;
  pages: number;
  tags?: Name[] | null;
}
interface ShortHentai {
  hash: string;
  thumbnail: number;
  description?: string | null;
  released_at?: string | null;
  created_at?: string | null;
  tags?: Name[] | null;
  size: number;
  pages: number;
}
interface Name {
  namespace: string;
  name: string;
}
interface Nodes {
  nodes: Data[];
}
interface Data {
  data: unknown[];
}
interface HentaiIndexes {
  hash: number;
  thumbnail: number;
  description: number;
  released_at: number;
  created_at: number;
  tags: number;
  size: number;
  pages: number;
}

// ======================== AnibusInterceptor.kt ========================
// The Anubis proof-of-work challenge is solved in a WebView upstream, i.e. by running the site's script: not ported.

const TMP_CDN_DOMAIN = "127.0.0.1";
const TMP_CDN_URL = `http://${TMP_CDN_DOMAIN}`;
const ARCHIVE_REGEX = /^\/archive\/(\d+)\/.*/;

const releasedAtFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT).withZone(ZoneOffset.UTC);
const createdAtFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT).withZone(ZoneOffset.UTC);

/** dateReformat: DateTimeFormatter.ofPattern("EEEE, d MMM yyyy HH:mm (z)", Locale.ENGLISH).withZone(ZoneId.systemDefault()) */
function dateReformat(date: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
      .formatToParts(new Date(date))
      .map((it) => [it.type, it.value]),
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} (${p.timeZoneName})`;
}

const joinNames = (tags: Name[]) => tags.map((it) => it.name).join(", ");
const primitive = (v: unknown) => (v === null || typeof v === "object" ? undefined : String(v));

export default class SpyFakku extends KeiSource {
  private readonly baseImageUrl = `${TMP_CDN_URL}/image`;

  private get baseApiUrl() {
    return `${this.baseUrl}/api`;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addInterceptor((request) => {
        const url = new URL(request.url);
        if (url.hostname === TMP_CDN_DOMAIN) {
          const base = new URL(this.baseUrl);
          url.protocol = "https:";
          url.hostname = base.hostname;
          url.port = base.port;
          return { ...request, url: url.href };
        }
        return request;
      })
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        if (new URL(request.url).hostname.includes("airdns")) {
          // Limited peek size to avoid OOM
          const document = parseHtml(this.host.load, new TextDecoder().decode(response.bytes().subarray(0, 1024 * 1024 * 5)), request.url);
          if (document.selectFirst("script#anubis_challenge") != null) {
            // resolveInWebView runs the challenge script in a WebView: never executed here
            throw new Error("Failed to resolve challenge in WebView");
          }
        }
        return response;
      })
      .rateLimit(2, 1000);
  }

  private readonly charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.baseApiUrl}/library?sort=released_at&page=${page}`));
  }

  private toMangasPage(response: Response): MangasPage {
    const library = response.parseAs<HentaiLib>();
    const mangas = library.archives.map((it) => this.toSManga(it));
    const hasNextPage = library.page * library.limit < library.total;

    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.baseApiUrl}/library?sort=created_at&page=${page}`));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseApiUrl}/library`).newBuilder();
    const terms = [query.trim()];

    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        url.addQueryParameter("sort", filter.getValue());
        if (filter.getValue() === "random") url.addQueryParameter("seed", this.generateSeed());
        url.addQueryParameter("order", filter.state!.ascending ? "asc" : "desc");
      } else if (filter instanceof SelectFilter) {
        url.addQueryParameter("limit", filter.vals[filter.state]);
      } else if (filter instanceof TextFilter) {
        if (filter.state.length) {
          terms.push(
            ...filter.state
              .split(",")
              .filter((it) => it.trim())
              .map((tag) => {
                const trimmed = tag.trim().replaceAll(" ", "_");
                return (trimmed.startsWith("-") ? "-" : "") + filter.type + ":" + (trimmed.startsWith("-") ? trimmed.slice(1) : trimmed);
              }),
          );
        }
      }
    }
    url.addQueryParameter("q", terms.join(" "));
    url.addQueryParameter("page", String(page));

    return this.toMangasPage(await this.client.get(url.build().toString()));
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const add = await this.getShortHentai(manga);

    const details = SManga.create();
    details.url = manga.url;
    details.title = manga.title;
    details.status = SManga.COMPLETED;
    {
      const groupedTags = add.tags;
      const group = (ns: string) => {
        const g = groupedTags?.filter((it) => it.namespace === ns);
        return g?.length ? g : undefined; // groupBy has no empty groups
      };
      const nonEmpty = (ns: string) => {
        const g = group(ns);
        return g?.length ? joinNames(g) : undefined;
      };

      const authors = group("circle") ?? group("artist");
      details.author = authors ? joinNames(authors) : undefined;
      details.artist = group("artist") ? joinNames(group("artist")!) : undefined;
      details.thumbnail_url = `${this.baseImageUrl}/${add.hash}/${add.thumbnail}?type=cover`;
      details.genre = group("tag") ? joinNames(group("tag")!) : undefined;

      let d = "";
      if (add.description != null) d += add.description + "\n\n";

      const circles = nonEmpty("circle");
      if (circles != null) d += "Circles: " + circles + "\n";
      const publishers = nonEmpty("publisher");
      if (publishers != null) d += "Publishers: " + publishers + "\n";
      const magazines = nonEmpty("magazine");
      if (magazines != null) d += "Magazines: " + magazines + "\n";
      const events = nonEmpty("event");
      if (events != null) d += "Events: " + events + "\n\n";
      const parodies = nonEmpty("parody");
      if (parodies != null) d += "Parodies: " + parodies + "\n";

      d += "Pages: " + add.pages + "\n\n";

      const released = releasedAtFormat.tryParseDateTime(add.released_at?.slice(0, 19));
      if (released !== 0) d += "Released: " + dateReformat(released) + "\n";

      const created = createdAtFormat.tryParseDateTime(add.created_at);
      if (created !== 0) d += "Added: " + dateReformat(created) + "\n";

      const size = add.size;
      d +=
        "Size: " +
        (size >= 300 * 1000 * 1000 ? `${(size / (1000.0 * 1000.0 * 1000.0)).toFixed(2)} GB` : size >= 100 * 1000 ? `${(size / (1000.0 * 1000.0)).toFixed(2)} MB` : size >= 1000 ? `${(size / 1000.0).toFixed(2)} kB` : `${size} B`);
      details.description = d;
    }
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: SManga has no update strategy here

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = manga.url;
    chapter.date_upload = releasedAtFormat.tryParseDateTime(add.released_at?.slice(0, 19));

    return new SMangaUpdate(details, [chapter]);
  }

  override getMangaUrl(manga: SManga) {
    return this.baseUrl + substringBefore(manga.url, "?");
  }

  // ============================= Chapters ==============================

  override getChapterUrl(chapter: SChapter) {
    return this.baseUrl + substringBefore(chapter.url, "?");
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    if (!chapter.url.includes("&hash=") && !chapter.url.includes("?")) {
      const path = substringBefore(chapter.url.replace(ARCHIVE_REGEX, (_, id: string) => `/g/${id}`), "?");

      const response = await this.client.get(this.baseApiUrl + path, undefined, { ensureSuccess: false });
      if (response.isSuccessful) {
        const hentai = response.parseAs<Hentai>();
        return Array.from({ length: hentai.pages }, (_, index) => new Page(index, "", `${this.baseImageUrl}/${hentai.hash}/${index + 1}`));
      }

      for (let i = 0; i < 3; i++) {
        try {
          const res = await this.client.get(`${this.baseUrl}${path}/__data.json`, undefined, { ensureSuccess: false });
          if (res.isSuccessful) {
            const add = this.getAdditionals(res.parseAs<Nodes>().nodes.at(-1)!.data);
            return Array.from({ length: add.pages }, (_, index) => new Page(index, "", `${this.baseImageUrl}/${add.hash}/${index + 1}`));
          }
        } catch {
          // retry
        }
      }
      throw new Error("Failed to fetch page list");
    }

    const hash = substringAfter(chapter.url, "hash=");
    const pages = Number.parseInt(substringBefore(substringAfter(chapter.url, "?"), "&"), 10);

    return Array.from({ length: pages }, (_, index) => new Page(index, "", `${this.baseImageUrl}/${hash}/${index + 1}`));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  // ============================= Utilities =============================

  private async getShortHentai(manga: SManga): Promise<ShortHentai> {
    const path = substringBefore(manga.url.replace(ARCHIVE_REGEX, (_, id: string) => `/g/${id}`), "?");

    const response = await this.client.get(this.baseApiUrl + path, undefined, { ensureSuccess: false });
    if (response.isSuccessful) return response.parseAs<ShortHentai>();

    for (let i = 0; i < 3; i++) {
      try {
        const res = await this.client.get(`${this.baseUrl}${path}/__data.json`, undefined, { ensureSuccess: false });
        if (res.isSuccessful) return this.getAdditionals(res.parseAs<Nodes>().nodes.at(-1)!.data);
      } catch {
        // retry
      }
    }
    throw new Error("Failed to fetch details");
  }

  private getAdditionals(data: unknown[]): ShortHentai {
    const getTags = (it: unknown[]): Name[] => it.map((i) => ({ namespace: primitive(data[Number(i) + 2])!, name: primitive(data[Number(i) + 3])! }));
    const hentaiIndexes = data[1] as HentaiIndexes;

    const hash = primitive(data[hentaiIndexes.hash])!;
    const thumbnail = Number(data[hentaiIndexes.thumbnail]);
    const description = primitive(data[hentaiIndexes.description]) ?? null;

    const releasedAt = primitive(data[hentaiIndexes.released_at]);
    const createdAt = primitive(data[hentaiIndexes.created_at]);
    const size = Number(data[hentaiIndexes.size]);
    const pages = Number(data[hentaiIndexes.pages]);

    const tagIndexes = data[hentaiIndexes.tags] as unknown[];
    const tags = tagIndexes.length ? getTags(tagIndexes) : null;

    return { hash, thumbnail, description, released_at: releasedAt, created_at: createdAt, tags, size, pages };
  }

  private toSManga(it: Hentai): SManga {
    const manga = SManga.create();
    manga.title = it.title;
    manga.url = `/g/${it.id}?${it.pages}&hash=${it.hash}`;
    manga.author = it.tags ? joinNames(it.tags.filter((t) => t.namespace === "circle")) : undefined;
    manga.artist = it.tags ? joinNames(it.tags.filter((t) => t.namespace === "artist")) : undefined;
    manga.genre = it.tags ? joinNames(it.tags.filter((t) => t.namespace === "tag")) : undefined;
    manga.thumbnail_url = `${this.baseImageUrl}/${it.hash}/${it.thumbnail}?type=cover`;
    manga.status = SManga.COMPLETED;
    return manga;
  }

  private generateSeed(): string {
    const length = 4 + Math.floor(Math.random() * 5);
    let string = "";
    for (let i = 0; i < length; i++) string += this.charset[Math.floor(Math.random() * this.charset.length)];
    return string;
  }
}
