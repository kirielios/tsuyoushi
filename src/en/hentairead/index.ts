// Port of keiyoushi/extensions-source src/en/hentairead/Hentairead.kt
import {
  Base64,
  DateTimeFormatter,
  GET,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  fromUtf8,
  substringAfter,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { Madara, absSrcset } from "../../../themes/madaralegacy/index.ts";
import { PageFilter, SortFilter, TextFilter, TypeFilter, UploadedFilter, getFilters } from "./filters.ts";

// HentaiReadDTO.kt
interface Results {
  results: { id: number; text: string }[];
}
interface ImageBaseUrlDto {
  baseUrl: string;
}
interface PagesDto {
  data: { chapter: { images: { src: string }[] } };
}

const capitalizeEach = (s: string) =>
  s
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

export default class Hentairead extends Madara {
  protected override dateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.US);

  private get cdnHeaders(): Headers {
    const h = super.headersBuilder();
    h.append("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    return h;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addInterceptor((request) => (request.url.includes("/wp-content/uploads/") ? { ...request, headers: this.cdnHeaders } : request));
  }

  protected override mangaSubString = "hentai";
  protected override popularMangaNextPageSelector(): string | null {
    return "a[rel=next]";
  }

  protected override mangaDetailsParse(document: Document | Response): SManga {
    if (!("select" in document)) document = document.asJsoup();
    const manga = SManga.create();
    const authors = document.select("a[href*=/circle/] span:first-of-type").eachText().join(", ");
    const artists = document.select("a[href*=/artist/] span:first-of-type").eachText().join(", ");
    manga.initialized = true;
    manga.author = authors || artists;
    manga.artist = artists || authors;
    manga.genre = document.select("a[href*=/tag/] span:first-of-type").eachText().join(", ");

    let description = "";
    const section = (selector: string, label: string) => {
      const it = document.select(selector).eachText().join(", ");
      if (it) description += `${label}: ${capitalizeEach(it)}\n\n`;
    };
    section("a[href*=/characters/] span:first-of-type", "Characters");
    section("a[href*=/parody/] span:first-of-type", "Parodies");
    section("a[href*=/circle/] span:first-of-type", "Circles");
    section("a[href*=/convention/] span:first-of-type", "Convention");
    section("a[href*=/scanlator/] span:first-of-type", "Scanlators");
    const alt = (document as Document).selectFirst(".manga-titles h2")?.text();
    if (alt) {
      const titles = alt
        .split("|")
        .map((it) => `- ${it.trim()}`)
        .join("\n");
      description += `Alternative Titles: \n${titles}\n\n`;
    }
    description += `${document.select(".items-center:contains(pages:)").text()}\n`;
    manga.description = description;
    manga.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: SManga has no update strategy here
    return manga;
  }

  override get supportsFilterFetching() {
    return false;
  }
  override getFilterList(): FilterList {
    return getFilters();
  }

  protected override searchLoadMoreRequest(page: number, query: string, _filters: FilterList): Request {
    const url = toHttpUrl(`${this.baseUrl}${this.searchPage(page)}`).newBuilder().addQueryParameter("s", query).addQueryParameter("post_type", "wp-manga").build();
    return GET(url, this.headers);
  }

  protected override popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?sortby=views`, this.headers);
  }
  protected override latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?sortby=new`, this.headers);
  }
  protected override popularMangaSelector() {
    return ".manga-item";
  }
  protected override popularMangaUrlSelector = "a.manga-item__link";

  private async getTagId(tag: string, type: string): Promise<number | null> {
    const ajax = `${this.baseUrl}/wp-admin/admin-ajax.php?action=search_manga_terms&search=${tag}&taxonomy=${type}`.replace("artist", "manga_artist");
    const res = await this.client.execute(GET(ajax, this.headers));
    const items = res.parseAs<Results>();
    const item = items.results.filter((it) => it.text.toLowerCase() === tag.toLowerCase());
    return item.length ? item[0].id : null;
  }

  protected override searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected override async searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegments(`page/${page}`);
    url.addQueryParameter("s", query);
    url.addQueryParameter("title-type", "contains");
    for (const it of filters) {
      if (it instanceof TypeFilter) {
        it.state.filter((stIt) => stIt.state).forEach((fil) => url.addQueryParameter("categories[]", fil.value));
      } else if (it instanceof PageFilter) {
        if (it.state.trim()) {
          const [min, max] = this.parsePageRange(it.state);
          url.addQueryParameter("pages", `${min}-${max}`);
        }
      } else if (it instanceof UploadedFilter) {
        if (it.state.trim()) {
          const type = it.state[0] === ">" ? "after" : it.state[0] === "<" ? "before" : "in";
          url.addQueryParameter("release-type", type);
          url.addQueryParameter("release", it.state.replace(/\D/g, ""));
        }
      } else if (it instanceof TextFilter) {
        if (it.state !== "") {
          for (const tag of it.state.split(",").filter((s) => s.trim())) {
            const trimmed = tag.trim();
            const name = trimmed.replace(/^-/, "");
            const id = (await this.getTagId(name, it.type))?.toString();
            if (id == null) {
              const t = it.type.toLowerCase();
              throw new Error(`${t.charAt(0).toUpperCase()}${t.slice(1)} not found: ${name}`);
            }
            if (it.type === "manga_tag") {
              url.addQueryParameter(trimmed.startsWith("-") ? "excluding[]" : "including[]", id);
            } else {
              url.addQueryParameter(`${it.type}s[]`, id);
            }
          }
        }
      } else if (it instanceof SortFilter) {
        url.addQueryParameter("sortby", it.getValue());
        url.addQueryParameter("order", it.state!.ascending ? "asc" : "desc");
      }
    }
    return GET(url.build(), this.headers);
  }

  private parsePageRange(query: string, minPages = 1, maxPages = 9999): [number, number] {
    const digits = query.replace(/\D/g, "");
    const num = digits ? Number(digits) : -1;
    const limitedNum = (number = num) => Math.min(Math.max(number, minPages), maxPages);

    if (num < 0) return [minPages, maxPages];
    switch (query[0]) {
      case "<":
        return [1, query[1] === "=" ? limitedNum() : limitedNum(num + 1)];
      case ">":
        return [limitedNum(query[1] === "=" ? num : num + 1), maxPages];
      case "=":
        if (query[1] === ">") return [limitedNum(), maxPages];
        if (query[1] === "<") return [1, limitedNum(maxPages)];
        return [limitedNum(), limitedNum()];
      default:
        return [limitedNum(), limitedNum()];
    }
  }

  // chapterExtraData = ({...});
  private readonly chapterExtraDataRegex = /= (\{[^;]+)/;

  // window.mMjM5MjM2 = '(eyJkYX...);
  private readonly pagesDataRegex = /.(ey\S+).\s/;

  // From ManhwaHentai - modified
  protected override async pageListParse(document: Document | Response): Promise<Page[]> {
    if (!("select" in document)) document = document.asJsoup();
    this.countViews(document);

    const extra = document.selectFirst("[id=single-chapter-js-extra]")?.data();
    const baseMatch = extra != null ? this.chapterExtraDataRegex.exec(extra)?.[1] : undefined;
    const pageBaseUrl = baseMatch != null ? (JSON.parse(baseMatch) as ImageBaseUrlDto).baseUrl : null;

    const before = document.selectFirst("[id=single-chapter-js-before]")?.data();
    const pagesMatch = before != null ? this.pagesDataRegex.exec(before)?.[1] : undefined;
    if (pagesMatch == null) throw new Error("Failed to find page list. Non-English entries are not supported.");
    const pages = JSON.parse(fromUtf8(Base64.decode(pagesMatch))) as PagesDto;

    const location = document.location();
    return pages.data.chapter.images.map((page, idx) => new Page(idx, location, `${pageBaseUrl}/${page.src}`));
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = manga.url;
    if (manga.description?.includes("Scanlators") === true) {
      chapter.scanlator = substringBefore(substringAfter(manga.description, "Scanlators: "), "\n");
    }
    return [chapter];
  }

  protected override pageListRequest(chapter: SChapter): Request {
    // There's like 2 non-English entries where this breaks
    const url = `${chapter.url}english/p/1/`;
    if (url.startsWith("http")) return GET(url, this.headers);
    return GET(this.baseUrl + url, this.headers);
  }

  protected override imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("srcset")) return substringBefore(absSrcset(element), " ").replace(/,$/, "");
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    return element.attr("abs:src");
  }
}
