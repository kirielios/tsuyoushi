// Port of keiyoushi/extensions-source src/en/doujinio/Doujinio.kt (with Dto.kt and WatermarkRemover.kt)
import {
  Canvas,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  aesCbcDecryptNoPadding,
  firstInstanceOrNull,
  imageSize,
  parseAs,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
} from "../../../sdk/index.ts";
import { SortFilter, TagGroup, type Tag } from "./filters.ts";

const LATEST_LIMIT = 20;

// --- Dto.kt
interface PageResponse<T> {
  data: T;
}
interface MangaDto {
  optimus_id: number;
  title: string;
  description: string;
  thumb: string;
  tags: Tag[];
  creator_name: string;
}
interface ChapterDto {
  optimus_id: number;
  manga_optimus_id: number;
  chapter_name: string;
  chapter_order: number;
  published_at: string;
}
interface ChapterManifest {
  metadata: { identifier: string };
  readingOrder: { href: string; type: string }[];
}
interface SearchResponse {
  data: MangaDto[];
  to: number | null;
  total: number;
}
interface MangaKeys {
  chmkeys: number[];
}

function mangaToSManga(m: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = `/manga/${m.optimus_id}`;
  manga.title = m.title;
  manga.description = m.description;
  manga.thumbnail_url = m.thumb;
  manga.artist = m.creator_name;
  manga.genre = m.tags.map((it) => it.name).join(", ");
  manga.status = SManga.COMPLETED;
  manga.initialized = true;
  return manga;
}

function chapterToSChapter(c: ChapterDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = `manga/${c.manga_optimus_id}/chapter/${c.optimus_id}`;
  // Can be equal to manga title (gets trimmed to empty)
  chapter.name = `⁣${c.chapter_name}`;
  chapter.date_upload = tryParseInstant(c.published_at);
  return chapter;
}

const pageList = (manifest: ChapterManifest, fragment: string): Page[] =>
  manifest.readingOrder.filter((page) => page.type.startsWith("image")).map((page, i) => new Page(i, "", page.href + fragment));

// --- WatermarkRemover.kt

// drmwasm_bg-*.wasm: Replace original data packed in image data with watermark area
async function replaceJpeg(host: ConstructorParameters<typeof Canvas>[0], image: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const ciphertext = extractCiphertext(image);
  const plaintext = await decrypt(ciphertext, key);

  // plaintext buffer: u32_be(size) | JPEG | u32_le(x, y, width, height)
  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const totalSize = view.getInt32(0, false);
  const jpegStart = 4; // skip size
  const jpegEnd = jpegStart + totalSize - 16;

  const x = view.getInt32(jpegEnd, true);
  const y = view.getInt32(jpegEnd + 4, true);
  // width and height are read (and unused) upstream as well

  const overlayBytes = plaintext.subarray(jpegStart, jpegEnd);
  const overlay = await imageSize(host, overlayBytes).catch(() => {
    throw new Error("Failed to decode overlay JPEG");
  });
  const base = await imageSize(host, image).catch(() => {
    throw new Error("Failed to decode base image");
  });

  const canvas = new Canvas(host, base.width, base.height);
  canvas.drawImage(image, 0, 0, base.width, base.height, 0, 0);
  canvas.drawImage(overlayBytes, 0, 0, overlay.width, overlay.height, x, y);
  return canvas.encode("jpeg", 90);
}

// Extract the cipher section in a 0xFFEA marker
function extractCiphertext(data: Uint8Array): Uint8Array {
  let offset = 2;

  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) break; // SOS
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const length = (data[offset] << 8) | data[offset + 1]; // u16 big-endian, includes itself
    const payloadStart = offset + 2;
    const payloadEnd = offset + length;

    const payload = data.slice(payloadStart, payloadEnd);

    if (payload.length >= 4 && payload[0] === 0x4d && payload[1] === 0x49 && payload[2] === 0x4c && payload[3] === 0x46) {
      // "MILF": skip tag (4 bytes) + extra 3 bytes
      return payload.slice(7);
    }
    offset = payloadEnd;
  }
  throw new Error("Failed to find encrypted segment");
}

/** AES/ECB/NoPadding. WebCrypto has no ECB: CBC with a zero IV yields D(C[i]) xor C[i-1], so xor the previous block back. */
async function decrypt(ciphertext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (ciphertext.length % 16 !== 0) throw new Error("Input length not multiple of 16 bytes");
  const out = await aesCbcDecryptNoPadding(key, new Uint8Array(16), ciphertext);
  for (let i = 16; i < out.length; i++) out[i] ^= ciphertext[i - 16];
  return out;
}

export default class Doujinio extends KeiSource {
  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const hash = request.url.includes("#") ? request.url.slice(request.url.indexOf("#") + 1) : "";
        let keys: MangaKeys | null = null;
        if (hash) {
          try {
            keys = parseAs<MangaKeys>(decodeURIComponent(hash));
          } catch {
            keys = null;
          }
        }
        if (keys == null) return chain.proceed(request);
        const response = await chain.proceed(request);

        const cleanedImage = await replaceJpeg(this.host, response.bytes(), Uint8Array.from(keys.chmkeys, (it) => it & 0xff));

        return Response.of(request.url, cleanedImage, response.header("content-type"), 200);
      })
      .rateLimit(2, 1000, (it) => it.hostname === this.baseUrlHost);
  }

  // Search/latest errors with 419 when referer or origin is present
  private get cleanHeaders() {
    const h = this.headersBuilder();
    h.delete("Referer");
    h.delete("Origin");
    return h;
  }

  private jsonHeaders(): Headers {
    const h = this.cleanHeaders;
    h.set("Content-Type", "application/json");
    return h;
  }

  // Latest

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.post(`${this.baseUrl}/api/mangas/newest`, this.jsonHeaders(), JSON.stringify({ limit: LATEST_LIMIT, offset: (page - 1) * LATEST_LIMIT }));
    const latest = this.parseData<MangaDto[]>(response).map(mangaToSManga);
    return new MangasPage(latest, latest.length >= LATEST_LIMIT);
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/api/mangas/popular`);
    return new MangasPage(this.parseData<MangaDto[]>(response).map(mangaToSManga), false);
  }

  // Search

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortFilter = firstInstanceOrNull(filters, SortFilter)!;
    const tags = firstInstanceOrNull(filters, TagGroup)?.tagIds ?? [];

    // encodeDefaults = false: an empty tags list equals its default and is not sent
    const body = JSON.stringify({ keyword: query, page, tags: tags.length ? tags : undefined, sort: sortFilter.sort, sort_dir: sortFilter.order });
    const response = await this.client.post(`${this.baseUrl}/api/mangas/search`, this.jsonHeaders(), body);

    const result = this.parseData<SearchResponse>(response);
    return new MangasPage(
      result.data.map(mangaToSManga),
      result.to != null ? result.to < result.total : false,
    );
  }

  // Details + Chapters

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${this.getIdFromUrl(manga.url)}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (this.baseUrlHost !== url.hostname || segments.length < 2) return null;
    return this.fetchMangaDetails(segments[1]);
  }

  private async fetchMangaDetails(id: string): Promise<SManga> {
    const response = await this.client.get(`${this.baseUrl}/api/mangas/${id}`);
    return mangaToSManga(this.parseData<MangaDto>(response));
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const id = this.getIdFromUrl(manga.url);

    const [m, c] = await Promise.all([
      fetchDetails ? this.fetchMangaDetails(id) : manga,
      (async () => {
        if (!fetchChapters) return chapters;
        const response = await this.client.get(`${this.baseUrl}/api/chapters?manga_id=${id}`);
        return this.parseData<ChapterDto[]>(response).map(chapterToSChapter).reverse();
      })(),
    ]);
    return new SMangaUpdate(m, c);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/${chapter.url}`;
  }

  // Page List

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterApiUrl = `${this.baseUrl}/api/mangas/${this.getIdsFromUrl(chapter.url)}`;
    const response = await this.client.get(`${chapterApiUrl}/manifest`);

    if (response.header("content-type")?.includes("text/html") === true) throw new Error("Login through WebView to read");

    let fragment: string;
    try {
      const res = await this.client.get(`${chapterApiUrl}/chm`);
      fragment = `#${JSON.stringify({ chmkeys: res.parseAs<MangaKeys>().chmkeys })}`;
    } catch {
      fragment = "";
    }

    return pageList(response.parseAs<ChapterManifest>(), fragment);
  }

  // Filters

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const response = await this.client.get(`${this.baseUrl}/api/tags`);
    return this.parseData<Tag[]>(response);
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: FilterList = [];
    if (data != null) filters.push(new TagGroup(data as Tag[]));
    filters.push(new SortFilter());
    return filters;
  }

  // Utilities

  private parseData<T>(response: Response): T {
    return response.parseAs<PageResponse<T>>().data;
  }

  private getIdFromUrl(url: string) {
    return url.split("/").at(-1)!;
  }

  private getIdsFromUrl(url: string) {
    return `${url.split("/")[1]}/${url.split("/").at(-1)}`;
  }
}
