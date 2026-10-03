// Port of keiyoushi/extensions-source src/all/webtoons/Webtoons.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  parseHtml,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type PreferenceScreen,
  type Request,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";
import { SearchType } from "./filters.ts";

// Dto.kt
interface EpisodeListResponse {
  result: { episodeList: Episode[] };
}
interface Episode {
  episodeTitle: string;
  viewerLink: string;
  exposureDateMillis: number;
  hasBgm?: boolean;
  chapterNumber: number; // var chapterNumber = -1f
  seasonNumber: number; // var seasonNumber = 1
}
interface MotionToonResponse {
  assets: { images: Record<string, string> };
}

const SHOW_AUTHORS_NOTES_KEY = "showAuthorsNotes";
const USE_MAX_QUALITY_KEY = "useMaxQuality";
const USE_SEQUENTIAL_NUMBERING_KEY = "useSequentialNumbering";

const f = Math.fround; // Kotlin Float arithmetic

/** DecimalFormat("#.##") */
const numberFormatter = (n: number) => String(Number(n.toFixed(2)));

export default class Webtoons extends KeiSource {
  // Due to lang code getting more specific for zh-Hant
  private get langCode() {
    return this.lang === "zh-Hant" ? "zh-hant" : this.lang;
  }
  private get localeForCookie() {
    return this.lang === "zh-Hant" ? "zh_TW" : this.lang;
  }

  private readonly mobileUrl = "https://m.webtoons.com";

  private get mobileHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Referer", `${this.mobileUrl}/`);
    h.delete("Origin");
    return h;
  }

  protected get supportRelatedMangasBySearch() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addInterceptor((request) =>
        this.addCookie(request, "webtoons.com", [
          ["ageGatePass", "true"],
          ["locale", this.localeForCookie],
          ["needGDPR", "false"],
        ]),
      )
      .addChainInterceptor(async (chain) => {
        // m.webtoons.com throws an SSL error that can be solved by a simple retry
        try {
          return await chain.proceed(chain.request());
        } catch {
          // ponytail: upstream retries only on SocketException; the host does not tell error kinds apart
          return chain.proceed(chain.request());
        }
      })
      .addChainInterceptor(TextInterceptor())
      .rateLimit(1, 1000, (it) => it.hostname === new URL(this.mobileUrl).hostname);
  }

  /** keiyoushi's addCookie(domain, cookies): (re)set in the jar for `domain` on every matching request, which then sends them. */
  private addCookie(request: Request, domain: string, cookies: [string, string][]): Request {
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  override async getPopularManga(page: number): Promise<MangasPage> {
    const ranking = ({ 1: "trending", 2: "popular", 3: "originals", 4: "canvas" } as Record<number, string>)[page];
    if (ranking == null) throw new Error("page > 4 not available");

    const document = (await this.client.get(`${this.baseUrl}/${this.langCode}/ranking/${ranking}`)).asJsoup();
    const entries = document.select(".webtoon_list li a").map((it) => this.mangaFromElement(it));

    return new MangasPage(entries, ranking !== "canvas");
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.absUrl("href"));
    manga.title = element.selectFirst(".title")!.text();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    return manga;
  }

  override async getLatestUpdates(_page: number): Promise<MangasPage> {
    const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];

    const document = (await this.client.get(`${this.baseUrl}/${this.langCode}/originals/${day}?sortOrder=UPDATE`)).asJsoup();
    const entries = document.select(".webtoon_list li a").map((it) => this.mangaFromElement(it));

    return new MangasPage(entries, false);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SearchType());
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    let searchTypeAdded = false;
    url.addPathSegment(this.langCode);
    url.addPathSegment("search");
    const selected = firstInstanceOrNull(filters, SearchType)?.selected;
    if (selected != null) {
      searchTypeAdded = true;
      url.addPathSegment(selected);
    }
    url.addQueryParameter("keyword", query);
    if (page > 1 && searchTypeAdded) {
      url.addQueryParameter("page", String(page));
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();
    const entries = document.select(".webtoon_list li a").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("a.pagination[aria-current=true] + a") != null;

    return new MangasPage(entries, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const titleNoStr = url.searchParams.get("title_no");
    if (titleNoStr == null || !/^[+-]?\d+$/.test(titleNoStr)) return null;
    const titleNo = Number(titleNoStr);
    const path = url.pathname.slice(1).split("/");
    if (path.length < 3) return null;

    // Every language ships as its own source; only the matching one resolves the link.
    if (path[0] !== this.langCode) return null;

    const manga = SManga.create();
    manga.url = `${path[1] === "canvas" ? "/challenge" : ""}/episodeList?titleNo=${titleNo}`;

    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    // details and the episode list are on different hosts
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : Promise.resolve(manga), fetchChapters ? this.fetchChapterList(manga) : Promise.resolve(chapters)]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const detailElement = document.selectFirst(".detail_header .info");
    const infoElement = document.selectFirst("#_asideDetail");

    const details = SManga.create();
    details.url = urlWithoutDomain(document.location());
    details.title = document.selectFirst("h1.subj, h3.subj")!.text();
    details.author = detailElement?.selectFirst(".author:nth-of-type(1)")?.ownText() ?? detailElement?.selectFirst(".author_area")?.ownText();
    details.artist = detailElement?.selectFirst(".author:nth-of-type(2)")?.ownText() ?? detailElement?.selectFirst(".author_area")?.ownText() ?? details.author;
    details.genre = (detailElement?.select(".genre") ?? []).map((it) => it.text()).join(", ");
    details.description = infoElement?.selectFirst("p.summary")?.text();
    const dayInfo = infoElement?.selectFirst("p.day_info")?.text() ?? "";
    if (dayInfo.includes("UP") || dayInfo.includes("EVERY") || dayInfo.includes("NOUVEAU")) details.status = SManga.ONGOING;
    else if (dayInfo.includes("END") || dayInfo.includes("COMPLETED") || dayInfo.includes("TERMINÉ")) details.status = SManga.COMPLETED;
    else details.status = SManga.UNKNOWN;

    const bannerSrc = document.selectFirst(".detail_header .thmb img")?.absUrl("src");
    const bannerFile = bannerSrc != null ? toHttpUrl(bannerSrc).pathSegments.at(-1) : undefined;
    const oldThumbFile = manga.thumbnail_url != null ? toHttpUrl(manga.thumbnail_url).pathSegments.at(-1) : undefined;
    const thumbnail = document.selectFirst('head meta[property="og:image"]')?.attr("content");

    // replace banner image for toons in library
    details.thumbnail_url = oldThumbFile != null && oldThumbFile !== bannerFile ? manga.thumbnail_url : thumbnail;
    return details;
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const webtoonUrl = toHttpUrl(this.getMangaUrl(manga));
    const titleId = webtoonUrl.queryParameter("title_no") ?? webtoonUrl.queryParameter("titleNo");
    if (titleId == null) throw new Error(`Migrate from ${this.name} to ${this.name}`);

    const path = webtoonUrl.pathSegments.filter((it) => it !== "");
    let type: string;
    // older url pattern, people have in their library
    if (webtoonUrl.encodedPath.includes("episodeList")) {
      // "/episodeList?titleNo=1049"
      if (path[0] === "episodeList") type = "webtoon";
      // "/challenge/episodeList?titleNo=304446"
      else if (path[0] === "challenge") type = "canvas";
      else throw new Error(`Migrate from ${this.name} to ${this.name}`);
    } else {
      // "/en/canvas/meme-girls/list?title_no=304446"
      type = path[1] === "canvas" ? "canvas" : "webtoon";
    }

    const url = toHttpUrl(this.mobileUrl).newBuilder();
    url.addPathSegments("api/v1");
    url.addPathSegment(type);
    url.addPathSegment(titleId);
    url.addPathSegment("episodes");
    url.addQueryParameter("pageSize", "99999");
    if (type === "canvas") url.addQueryParameter("readingLanguageCode", this.langCode);

    const result = (await this.client.get(url.build().toString(), this.mobileHeaders)).parseAs<EpisodeListResponse>();

    let recognized = 0;
    let unrecognized = 0;

    const chapters = result.result.episodeList;
    for (const episode of chapters) {
      const m = episodeNoRegex.exec(episode.episodeTitle);
      const match = m != null && !m[6] ? m : null; // skip mini/bonus episodes

      episode.chapterNumber = match?.[11] != null ? f(Number(match[11])) : -1;
      episode.seasonNumber = match?.[4] != null && match[4].trim() ? Number.parseInt(match[4], 10) : 1;

      if (episode.chapterNumber === -1) unrecognized++;
      else recognized++;
    }

    if (this.useSequentialNumberingPref() || unrecognized > recognized) {
      chapters.forEach((chapter, index) => (chapter.chapterNumber = index + 1));
    } else {
      let maxChapterNumber = 0;
      let currentSeason = 1;
      let seasonOffset = 0;

      chapters.forEach((chapter, idx) => {
        if (chapter.chapterNumber !== -1) {
          const originalNumber = chapter.chapterNumber;

          // Check if we've moved to a new season
          if (chapter.seasonNumber > currentSeason) {
            currentSeason = chapter.seasonNumber;
            if (originalNumber <= maxChapterNumber) {
              seasonOffset = maxChapterNumber;
            }
          }

          chapter.chapterNumber = f(seasonOffset + originalNumber);
          maxChapterNumber = Math.max(maxChapterNumber, chapter.chapterNumber);
        } else {
          const previous = chapters[idx - 1];
          chapter.chapterNumber = previous == null ? 0 : f(previous.chapterNumber + f(0.01));
        }
      });
    }

    return chapters
      .map((episode) => {
        const chapter = SChapter.create();
        chapter.url = episode.viewerLink;
        chapter.name = `${this.unescapeEntities(episode.episodeTitle)} (ch. ${numberFormatter(episode.chapterNumber)})${episode.hasBgm ? " ♫" : ""}`;
        chapter.date_upload = episode.exposureDateMillis;
        chapter.chapter_number = episode.chapterNumber;
        return chapter;
      })
      .reverse();
  }

  /** Parser.unescapeEntities(s, false): textarea content is RCDATA, so only entities are decoded. */
  private unescapeEntities(s: string): string {
    return parseHtml(this.host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText();
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const useMaxQuality = this.useMaxQualityPref();

    const pages = document.select("div#_imageList > img").map((element, i) => {
      const imageUrl = toHttpUrl(element.attr("data-url"));

      if (useMaxQuality && imageUrl.queryParameter("type") === "q90") {
        const newImageUrl = imageUrl.newBuilder().removeAllQueryParameters("type").build();
        return new Page(i, "", newImageUrl.toString());
      }
      return new Page(i, "", imageUrl.toString());
    });

    if (!pages.length) {
      pages.push(...(await this.fetchMotionToonPages(document)));
    }

    if (this.showAuthorsNotesPref()) {
      const note = document.select("div.creator_note p.author_text").text();

      if (note) {
        const creator = document.select("div.creator_note .author_name span").text().trim();
        pages.push(new Page(pages.length, "", TextInterceptorHelper.createUrl(`Author's Notes from ${creator}`, note)));
      }
    }

    return pages;
  }

  private async fetchMotionToonPages(document: Document): Promise<Page[]> {
    const docString = document.outerHtml();

    const docUrlRegex = /documentURL:.*?'(.*?)'/;
    const motionToonPathRegex = /jpg:.*?'(.*?)\{/;

    const docUrl = docUrlRegex.exec(docString)![1];
    const motionToonPath = motionToonPathRegex.exec(docString)![1];
    const motionToonImages = (await this.client.get(docUrl)).parseAs<MotionToonResponse>().assets.images;

    return Object.entries(motionToonImages)
      .filter(([key]) => key.includes("layer"))
      .map(([, value], i) => new Page(i, "", motionToonPath + value));
  }

  private showAuthorsNotesPref() {
    return this.preferences.getBoolean(SHOW_AUTHORS_NOTES_KEY, false);
  }
  private useMaxQualityPref() {
    return this.preferences.getBoolean(USE_MAX_QUALITY_KEY, false);
  }
  private useSequentialNumberingPref() {
    return this.preferences.getBoolean(USE_SEQUENTIAL_NUMBERING_KEY, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const add = (key: string, title: string, summary: string) => {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = title;
      p.summary = summary;
      p.setDefaultValue(false);
      screen.addPreference(p);
    };
    add(SHOW_AUTHORS_NOTES_KEY, "Show author's notes", "Enable to see the author's notes at the end of chapters (if they're there).");
    add(USE_MAX_QUALITY_KEY, "Use maximum quality images", "Enable to load images in maximum quality.");
    add(USE_SEQUENTIAL_NUMBERING_KEY, "Use sequential chapter numbering", "Enable to use sequential numbering instead of official episode numbers.");
  }
}

// season number - 4 capture group
// possible bonus/mini/special episode - 6 capture group
// episode number - 11 capture group
const episodeNoRegex = /(?:(s(eason)?|saison|part|vol(ume)?)\s*\.?\s*(\d+).*?)?(.*?(mini|bonus|special).*?)?(e(p(isode)?)?|ch(apter)?)\s*\.?\s*(\d+(\.\d+)?)/i;
