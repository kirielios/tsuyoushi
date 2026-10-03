// Port of keiyoushi/extensions-source src/en/darthsdroids/DarthsDroids.kt
import {
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  urlWithoutDomain,
  type ClientBuilder,
  type FilterList,
} from "../../../sdk/index.ts";

// Dear Darths & Droids creators:
// I’m sorry if this extension causes too much traffic for your site.
// Unfortunately we can’t just download and use your Zip downloads.
// Shall problems arise, we’ll reduce the rate limit.

const DATE_FMT = DateTimeFormatter.ofPattern("EEE d MMM, yyyy", Locale.US);
const EXTR_PAGE_DATE = /Published:\s+(\w+,\s+\d+\s+\w+,\s+\d+;\s+\d+:\d+:\d+\s+\w+)/;
const PAGE_DATE_FMT = DateTimeFormatter.ofPattern("EEEE, d MMMM, yyyy; HH:mm:ss z", Locale.US);

export default class DarthsDroids extends KeiSource {
  private get baseUrlHost() {
    return new URL(this.baseUrl).host;
  }

  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(10, 1000, (url) => url.host === this.baseUrlHost);
  }

  // Picks a thumbnail from the profile pictures of the »cast« pages:
  //   https://www.darthsanddroids.net/cast/
  //
  // Where possible, pick a thumbnail from the corresponding book’s cast page. Try to avoid having a character appear more
  // than once as thumbnail, giving all main characters equal amounts of spotlight. Pick a character people would
  // intuïtively associate with the corresponding film, like Qui-Gon for Phantom Menace or Leia for A New Hope.
  //
  // If a book doesn’t have its own cast page, try source a fitting profile picture from a different page. Avoid sourcing
  // thumbnails from a different website.
  private dndThumbnailUrlForTitle(nthManga: number): string {
    // The numbers are assigned in order of appearance of a book on the archive page.
    switch (nthManga) {
      case 0:
        return `${this.baseUrl}/cast/QuiGon.jpg`;
      case 1: // D&D1
        return `${this.baseUrl}/cast/Anakin2.jpg`;
      case 2: // D&D2
        return `${this.baseUrl}/cast/ObiWan3.jpg`;
      case 3: // D&D3
        return `${this.baseUrl}/cast/JarJar2.jpg`;
      case 4: // JJ
        return `${this.baseUrl}/cast/Leia4.jpg`;
      case 5: // D&D4
        return `${this.baseUrl}/cast/Han5.jpg`;
      case 6: // D&D5
        return `${this.baseUrl}/cast/Luke6.jpg`;
      case 7: // D&D6
        return `${this.baseUrl}/cast/Cassian.jpg`;
      case 8: // R1
        return `${this.baseUrl}/cast/C3PO4.jpg`;
      case 9: // Muppets
        return `${this.baseUrl}/cast/Finn7.jpg`;
      case 10: // D&D7
        return `${this.baseUrl}/cast/Han4.jpg`;
      case 11: // Solo
        return `${this.baseUrl}/cast/Hux8.jpg`;
      default:
        // D&D8
        // Just some nonsense fallback that screams »Star Wars« but is also so recognisably OT that one can understand it’s
        // a mere fallback. Better thumbnails require an extension update.
        return `${this.baseUrl}/cast/Vader4.jpg`;
    }
  }

  private dndManga(archiveUrl: string, mangaTitle: string, mangaStatus: number, nthManga: number): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(archiveUrl);
    manga.thumbnail_url = this.dndThumbnailUrlForTitle(nthManga);
    manga.title = mangaTitle;
    manga.author = "David Morgan-Mar & Co.";
    manga.artist = "David Morgan-Mar & Co.";
    manga.description = [
      "What if Star Wars as we know it didn't exist, but instead the",
      "plot of the movies was being made up on the spot by players of",
      "a Tabletop Game?",
      "",
      "Well, for one, the results might actually make a lot more sense,",
      "from an out-of-story point of view…",
    ].join("\n");
    manga.genre = "Campaign Comic, Comedy, Space Opera, Science Fiction";
    manga.status = mangaStatus;
    // update_strategy (COMPLETED -> ONLY_FETCH_ONCE, else ALWAYS_UPDATE) has no counterpart in our SManga
    manga.initialized = true;
    return manga;
  }

  // The book and page archive feeds are rather special for this webcomic.
  // The main archive page `/archive.html` is a combined feed for both, all previous and finished books, as well as all
  // pages of the book that is currently releasing. Every finished book gets its own archive page like `/archive4.html` or
  // `/archiveJJ.html` into which all page links are moved. So whatever book is currently releasing in `/archive.html` will
  // eventually be moved into its own archive, and it’ll instead appear as a book-archive link in `/archive.html`.
  //
  // This means a few things:
  // • The currently releasing book eventually changes its `url`!
  // • The URL of the currently releasing book will be taken over by whichever new book comes next.
  // • There is no deterministic way of guessing a book’s future archive name.
  //   ◦ This is especially apparent with the »Solo« book, which’s archive page is `/solo/`, while all others are
  //     `/archiveX.html`.
  //
  // So eventually, Tachiyomi & Co. will glitch out once a currently releasing book finishes. People will find the current
  // book’s page feed to be empty. Even worse, they may find it starting anew with different pages. A manual refresh
  // *should* change the book’s `url` to its new archive page, and all reading progress should be preserved. Then the user
  // will have to manually add the new book to their library.
  //
  // The alternative would be to have a pseudo book »<Title> (ongoing)« that just disappears, being replaced by »<Title>«.
  // But i think that’s even worse in terms of user experience.
  async getPopularManga(_page: number): Promise<MangasPage> {
    const mainArchive = (await this.client.get(`${this.baseUrl}/archive.html`)).asJsoup();
    const archiveData = mainArchive.select("div.text > table.text > tbody > tr");

    const mangas: SManga[] = [];
    let nextMangaTitle = this.name;
    let nthManga = 0;

    for (const it of archiveData) {
      const maybeTitle = it.selectFirst("th")?.text();
      if (maybeTitle != null) {
        nextMangaTitle = `${this.name} ${maybeTitle}`;
      } else {
        const maybeArchive = it.selectFirst('td[colspan="3"] > a')?.absUrl("href");
        if (maybeArchive != null) {
          mangas.push(this.dndManga(maybeArchive, nextMangaTitle, SManga.COMPLETED, nthManga++));
        } else {
          // We reached the end, assuming the page layout stays consistent beyond D&D8.
          // Thus, we append our final manga with this current page as its archive.
          // Unfortunately this means we will needlessly fetch this page twice.
          mangas.push(this.dndManga("/archive.html", nextMangaTitle, SManga.ONGOING, nthManga));
          break;
        }
      }
    }

    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [updatedManga, updatedChapters] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  // Not efficient, but the simplest way for me to refresh.
  // We also can’t really use the `mangaDetailsRequest + mangaDetailsParse` approach, for we actually expect one of the
  // books’ `url`s to change.
  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    // Do not test for URL-equality, for the last book will always eventually migrate its archive page from
    // `/archive.html` to its own page.
    const found = (await this.getPopularManga(0)).mangas.find((it) => it.title === manga.title);
    if (!found) throw new Error("NoSuchElementException: Collection contains no element matching the predicate.");
    return found;
  }

  // This implementation here is needlessly complicated, for it has to automatically detect whether we’re in a
  // date-annotated archive, the main archive, or a dateless archive. All three are largely similar, there are just *some*
  // (annoying) differences we have to deal with.
  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const archivePages = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    // For books where all pages released the same day, there is no page date column, so instead we grab the release date
    // of the archive page itself from its footer.
    const pageDate =
      archivePages
        .select("br + i")
        .map((it) => EXTR_PAGE_DATE.exec(it.text())?.[1])
        .filter((it): it is string => it != null)
        .map((it) => PAGE_DATE_FMT.tryParseZonedDateTime(it))[0] ?? 0;
    let i = 0;

    const chapters: SChapter[] = [];
    for (const it of archivePages.select("div.text > table.text > tbody > tr")) {
      const pageData = it.select("td");
      let pageAnchor = pageData[2]?.selectFirst("a") ?? null;
      // null for »Intermission«, main archive, dateless archive,…
      if (pageAnchor != null) {
        const c = SChapter.create();
        c.name = pageAnchor.text();
        c.chapter_number = i++;
        c.date_upload = DATE_FMT.tryParseDate(pageData[0].text());
        c.url = urlWithoutDomain(pageAnchor.absUrl("href"));
        chapters.push(c);
      } else if (!pageData.some((e) => e.hasAttr("colspan"))) {
        // Are we in a dateless archive?
        pageAnchor = pageData[0]?.selectFirst("a") ?? null;
        if (pageAnchor != null) {
          const c = SChapter.create();
          c.name = pageAnchor.text();
          c.chapter_number = i++;
          c.date_upload = pageDate;
          c.url = urlWithoutDomain(pageAnchor.absUrl("href"));
          chapters.push(c);
        }
      }
    }
    return chapters.reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    // Careful. For almost all images it’s `div.center>p>img`, except for pages released on April’s Fools day, when it’s
    // `div.center>p>a>img`. We could still add the `p` in between, but it was decided to leave it out, in case yet another
    // *almost* same page layout pops up in the future.
    //
    // For example, this episode was released during April’s Fools day.
    // https://www.darthsanddroids.net/episodes/0082.html
    return (await this.client.get(this.getChapterUrl(chapter)))
      .asJsoup()
      .select("div.center img")
      .map((img, i) => new Page(i, "", img.absUrl("src")));
  }
}
