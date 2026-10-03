// Port of keiyoushi/extensions-source src/all/deviantart/DeviantArt.kt
import { DateTimeFormatter, FilterList, KeiSource, ListPreference, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringBefore, toHttpUrl, urlWithoutDomain, type Document, type PreferenceScreen, type Response } from "../../../sdk/index.ts";

const SEARCH_FORMAT_MSG = "Please enter a query in the format of gallery:{username} or gallery:{username}/{folderId}";
const GALLERY_QUERY_REGEX = /^gallery:([\w-]+)(?:\/(\d+))?$/;
const IMAGE_ORIGINAL_URL_REGEX = /\/v1(\/.*)?(?=\?)/;

const ArtistInTitle = {
  PREF_KEY: "artistInTitlePref",
  entries: [
    { name: "NEVER", text: "Never" },
    { name: "ALWAYS", text: "Always" },
    { name: "ONLY_ALL_GALLERIES", text: 'Only in "All" galleries' },
  ],
  defaultValue: "ONLY_ALL_GALLERIES",
};

export default class DeviantArt extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly backendBaseUrl = "https://backend.deviantart.com";
  private backendBuilder() {
    return toHttpUrl(this.backendBaseUrl).newBuilder();
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.ENGLISH);

  async getPopularManga(_page: number): Promise<MangasPage> {
    throw new Error(SEARCH_FORMAT_MSG);
  }
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error(SEARCH_FORMAT_MSG);
  }

  // ============================== Search ===================================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;

    const segments = url.pathname.slice(1).split("/");
    const username = segments[0];
    const folderId = segments[2];
    if (username == null || folderId == null) return null;
    const link = `${this.baseUrl}/${username}/gallery/${folderId}`;
    const document = (await this.client.get(link)).asJsoup();

    return this.parseGalleryDetails(document, link);
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const matchGroups = GALLERY_QUERY_REGEX.exec(query);
    if (!matchGroups) throw new Error(SEARCH_FORMAT_MSG);
    const username = matchGroups[1];
    const folderId = matchGroups[2] ? matchGroups[2] : "all";
    const link = `${this.baseUrl}/${username}/gallery/${folderId}`;
    const document = (await this.client.get(link)).asJsoup();

    return new MangasPage([this.parseGalleryDetails(document, link)], false);
  }

  // ============================== Details + Chapters =======================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const link = this.getMangaUrl(manga);

    const [updatedManga, updatedChapters] = await Promise.all([
      fetchDetails ? this.client.get(link).then((r) => this.parseGalleryDetails(r.asJsoup(), link)) : manga,
      fetchChapters ? this.fetchGalleryChapterList(manga) : chapters,
    ]);

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private parseGalleryDetails(document: Document, link: string): SManga {
    const gallery = document.selectFirst("#content");

    // If manga is sub-gallery then use sub-gallery name, else use gallery name
    const galleryName = gallery?.selectFirst(".DWReDc")?.ownText() ?? gallery!.selectFirst("[aria-haspopup=listbox] > div")!.ownText();
    const pref = this.preferences.getString(ArtistInTitle.PREF_KEY, ArtistInTitle.defaultValue);
    const artistInTitle = pref === "ALWAYS" || (pref === "ONLY_ALL_GALLERIES" && galleryName === "All");

    const manga = SManga.create();
    manga.url = urlWithoutDomain(link);
    // Jsoup's Document.title(): the first <title>'s text
    manga.author = substringBefore(document.selectFirst("title")?.text() ?? "", " ");
    manga.title = artistInTitle ? `${manga.author} - ${galleryName}` : galleryName;
    manga.description = gallery!.selectFirst(".legacy-journal")?.wholeText();
    manga.thumbnail_url = gallery!.selectFirst("img[property=contentUrl]")?.absUrl("src");
    return manga;
  }

  private async fetchGalleryChapterList(manga: SManga): Promise<SChapter[]> {
    const pathSegments = toHttpUrl(this.getMangaUrl(manga)).pathSegments;
    const username = pathSegments[0];
    const folderId = pathSegments[2];
    const query = folderId === "all" ? `gallery:${username}` : `gallery:${username}/${folderId}`;

    const url = this.backendBuilder().addPathSegment("rss.xml").addQueryParameter("q", query).build();

    const document = (await this.client.get(url.toString())).asXml();
    const chapterList = this.parseToChapterList(document);
    let nextUrl = document.selectFirst("[rel=next]")?.absUrl("href");

    while (nextUrl) {
      const newDocument = (await this.client.get(nextUrl)).asXml();
      chapterList.push(...this.parseToChapterList(newDocument));

      nextUrl = newDocument.selectFirst("[rel=next]")?.absUrl("href");
    }

    this.orderChapterList(chapterList);
    return chapterList;
  }

  private parseToChapterList(document: Document): SChapter[] {
    return document.select("item").map((it) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(it.selectFirst("link")!.text());
      chapter.name = it.selectFirst("title")!.text();
      const pubDate = it.selectFirst("pubDate")?.text();
      chapter.date_upload = pubDate != null ? this.dateFormat.tryParseZonedDateTime(pubDate) : 0;
      chapter.scanlator = it.selectFirst("media\\:credit")?.text();
      return chapter;
    });
  }

  private orderChapterList(chapterList: SChapter[]) {
    // In Mihon's updates tab, chapters are ordered by source instead
    // of chapter number, so to avoid updates being shown in reverse,
    // disregard source order and order chronologically instead
    if (chapterList.length === 0) throw new Error("List is empty.");
    if (chapterList[0].date_upload < chapterList[chapterList.length - 1].date_upload) chapterList.reverse();
    chapterList.forEach((chapter, i) => {
      chapter.chapter_number = chapterList.length - i;
    });
  }

  // ============================== Pages =====================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const buttons = document.selectFirst("[draggable=false]")?.children();
    if (buttons == null) {
      const imageUrl = document.selectFirst("img[fetchpriority=high]")?.absUrl("src");
      return [new Page(0, "", imageUrl)];
    }
    return buttons.map((button, i) => {
      // Remove everything past "/v1/" to get original instead of thumbnail
      // But need to preserve the query parameter where the token is
      const imageUrl = button.selectFirst("img")?.absUrl("src").replace(IMAGE_ORIGINAL_URL_REGEX, "");
      return new Page(i, "", imageUrl);
    });
  }

  // ============================== Settings ===================================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const artistInTitlePref = new ListPreference();
    artistInTitlePref.key = ArtistInTitle.PREF_KEY;
    artistInTitlePref.title = "Artist name in manga title";
    artistInTitlePref.entries = ArtistInTitle.entries.map((it) => it.text);
    artistInTitlePref.entryValues = ArtistInTitle.entries.map((it) => it.name);
    artistInTitlePref.summary =
      "Current: %s\n\n" +
      "Changing this preference will not automatically apply to manga in Library " +
      "and History, so refresh all DeviantArt manga and/or clear database in Settings " +
      "> Advanced after doing so.";
    artistInTitlePref.setDefaultValue(ArtistInTitle.defaultValue);

    screen.addPreference(artistInTitlePref);
  }
}
