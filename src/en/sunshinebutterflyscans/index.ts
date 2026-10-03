// Port of keiyoushi/extensions-source src/en/sunshinebutterflyscans/SunshineButterflyScans.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, Base64, firstInstance, substringAfter, toHttpUrl, type ClientBuilder } from "../../../sdk/index.ts";
import { CryptoAES } from "../../../libs/cryptoaes/index.ts";
import { entryToSChapter, entryToSManga, type EntryDto, type GoogleDriveResponseDto, type ImgurResponseDto } from "./dto.ts";

const GOOGLE_DRIVE_FIRST = 'https://www.googleapis.com/drive/v3/files?q="';
const GOOGLE_DRIVE_SECOND = '"+in+parents&key=AIzaSyDDWjOHN1UPcafkwyJLO7fX1gmVyntIozs&orderBy=name_natural&fields=files(id,name,imageMediaMetadata)&pageSize=250';
const IMGUR_FIRST = "https://api.imgur.com/3/album/";
const IMGUR_SECOND = "/images";
const IMGUR_CLIENT_ID = "227a2add62d2c9c";
const KEY = Base64.decode("YX+1nM4KgfaYwNE3/MPcTg==");
const IV = Base64.decode("279GjT2Xu9LZBkI4zLzIAg==");

export class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Current", "current"],
      ["Complete", "complete"],
      ["Dropped", "dropped"],
      ["Licensed", "licensed"],
    ]);
  }
}

const SORT_VALUES = ["Name", "Last Updated"];
export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort by", SORT_VALUES, { index: 0, ascending: false });
  }
  getSelection(): [string, boolean] {
    return [SORT_VALUES[this.state!.index], this.state!.ascending];
  }
}

const sortedBy = <T>(list: T[], key: (it: T) => number | string, descending: boolean): T[] =>
  [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (descending ? -1 : 1);
  });
const timestampOf = (e: EntryDto) => {
  const n = /^[+-]?\d+$/.test(e.timestamp) ? Number(e.timestamp) : Number.MAX_SAFE_INTEGER; // toLongOrNull() ?: Long.MAX_VALUE
  return n;
};

export default class SunshineButterflyScans extends KeiSource {
  private get cdnUrl() {
    return `${this.baseUrl}/images/projcoverjpeg/`;
  }

  // Madara -> custom theme

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  private apiHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("Accept", "*/*");
    return h;
  }

  private chaptersData?: Promise<EntryDto[][]>;

  private getChaptersData(): Promise<EntryDto[][]> {
    // one shared fetch (upstream's mutex); a failed fetch is retried on the next call
    this.chaptersData ??= (async () => {
      const entries = (await this.client.get(`${this.baseUrl}/json/chapters.json`, this.apiHeaders())).parseAs<EntryDto[]>();
      const groups = new Map<string, EntryDto[]>();
      for (const it of entries) {
        const g = groups.get(it.series);
        if (g) g.push(it);
        else groups.set(it.series, [it]);
      }
      return [...groups.values()].map((it) => sortedBy(it, (e) => e.num, true));
    })().catch((e) => {
      this.chaptersData = undefined;
      throw e;
    });
    return this.chaptersData;
  }

  // ============================== Popular ===============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    const mangaList = sortedBy(await this.getChaptersData(), (it) => it[0].series, false).map((it) => entryToSManga(it[0], this.cdnUrl));
    return new MangasPage(mangaList, false);
  }

  // =============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const mangaList = sortedBy(await this.getChaptersData(), (it) => timestampOf(it[0]), true).map((it) => entryToSManga(it[0], this.cdnUrl));
    return new MangasPage(mangaList, false);
  }

  // =============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const selectedStatus = firstInstance(filters, StatusFilter).toUriPart();
    const selectedSort = firstInstance(filters, SortFilter).getSelection();

    const data = await this.getChaptersData();
    const sortedList = selectedSort[0] === "Name" ? sortedBy(data, (it) => it[0].series, false) : sortedBy(data, (it) => timestampOf(it[0]), true);

    const filteredList = sortedList.filter((it) => it[0].series.toLowerCase().includes(query.toLowerCase())).filter((it) => it[0].projectstatus.includes(selectedStatus));

    const reversedList = selectedSort[1] ? [...filteredList].reverse() : filteredList;

    return new MangasPage(reversedList.map((it) => entryToSManga(it[0], this.cdnUrl)), false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const n = url.searchParams.get("n");
    if (url.host !== toHttpUrl(this.baseUrl).host || url.pathname.split("/").filter((s) => s !== "")[0] !== "projects" || n == null) return null;

    const mangaUrl = `/projects?n=${n}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // =============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new SortFilter());
  }

  // =========================== Manga Updates ============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const target = substringAfter(manga.url, "?n=");
    const mangaData = (await this.getChaptersData()).find((it) => it[0].projectname === target);
    if (!mangaData) throw new Error("Collection contains no element matching the predicate.");
    return new SMangaUpdate(entryToSManga(mangaData[0], this.cdnUrl), mangaData.map(entryToSChapter));
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const key = substringAfter(chapter.url, "series=");
    const chapterDto = (await this.getChaptersData()).flat().find((it) => `${it.projectname}&num=${it.num}` === key);
    if (!chapterDto) throw new Error("Collection contains no element matching the predicate.");
    const decrypted = await CryptoAES.decrypt(chapterDto.AlbumID, KEY, IV);
    const isGoogleDrive = decrypted.length > 10;

    const url = isGoogleDrive ? GOOGLE_DRIVE_FIRST + decrypted + GOOGLE_DRIVE_SECOND : IMGUR_FIRST + decrypted + IMGUR_SECOND;
    const headers = this.headersBuilder();
    headers.set("Host", toHttpUrl(url).host);
    if (decrypted.length <= 10) headers.append("Authorization", `Client-ID ${IMGUR_CLIENT_ID}`);

    const response = await this.client.get(url, headers);
    if (isGoogleDrive) {
      return sortedBy(response.parseAs<GoogleDriveResponseDto>().files, (it) => it.name, false).map(
        (file, index) => new Page(index, "", `https://lh3.googleusercontent.com/d/${file.id}=w${file.imageMediaMetadata.width}`),
      );
    }
    return response.parseAs<ImgurResponseDto>().data.map((data, index) => new Page(index, "", data.link));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const imgHeaders = this.headersBuilder();
    imgHeaders.append("Accept", "image/avif,image/webp,*/*");
    imgHeaders.append("Host", toHttpUrl(page.imageUrl!).host);
    return { url: page.imageUrl!, headers: imgHeaders };
  }
}
