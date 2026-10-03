// Port of keiyoushi/extensions-source src/id/astralscans/AstralScans.kt
import { Base64, SChapter, SMangaUpdate, fromUtf8, parseHtml, urlWithoutDomain, type Document, type Element, type SManga } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class AstralScans extends MangaThemesia {
  override hasProjectPage = true;

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const body = new URLSearchParams({ ts_action: "get_chapters" });

    const headers = this.headersBuilder();
    headers.append("X-Requested-With", "XMLHttpRequest");
    headers.append("X-Protect", "1");
    const response = await this.client.post(this.baseUrl + manga.url, headers, body);

    return this.parseChapters(response.text());
  }

  private asJsoup(html: string): Document {
    return parseHtml(this.host.load, html, this.baseUrl);
  }

  private parseChapters(rawResponse: string): SChapter[] {
    const responseText = rawResponse.trim();

    if (responseText.startsWith("AST_")) {
      try {
        const payload = responseText.slice("AST_".length);
        const decoded = fromUtf8(Base64.decode([...payload].reverse().join("")));
        const parts = decoded.split("^^^");

        if (parts.length >= 2) {
          const rawHtml = parts[0];
          const dynamicDataAttr = parts[1];

          const chapters = this.asJsoup(rawHtml)
            .select(`[${dynamicDataAttr}]`)
            .flatMap((element) => {
              const encodedUrl = element.attr(dynamicDataAttr);
              let chapterUrl: string;
              try {
                chapterUrl = fromUtf8(Base64.decode(encodedUrl));
              } catch {
                chapterUrl = encodedUrl;
              }

              const spans = element.select("span");
              const name = spans.first()?.text() ?? "Chapter";
              const dateText = spans[1]?.text();

              const isTrap =
                chapterUrl.includes("chp_trap") ||
                name.toLowerCase().includes("trap") ||
                dateText?.toLowerCase().includes("trap") === true ||
                element.hasClass("trap") ||
                element.attr("class").includes("trap") ||
                closest(element, "[class*=trap]") != null;

              if (isTrap) return [];

              const chapter = SChapter.create();
              chapter.url = urlWithoutDomain(chapterUrl);
              chapter.name = name;
              chapter.date_upload = dateText != null ? this.parseChapterDate(dateText) : 0;
              return [chapter];
            });

          if (chapters.length) return chapters;
        }
      } catch {
        // fall through
      }
    }

    return this.chapterListParse(this.asJsoup(responseText));
  }

  override chapterListParse(document: Document): SChapter[] {
    const text = (document.selectFirst("body") ?? document).text().trim();
    if (text.startsWith("AST_")) return this.parseChapters(text);

    // Fallback: If site reverts to standard MangaThemesia DOM elements
    return super.chapterListParse(document);
  }

  protected override chapterListSelector() {
    return "div#kumpulan-bab-area .astral-item, div.eplister li";
  }

  protected override chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElement = element.selectFirst("a");
    const dataU = element.selectFirst(".js-link")?.attr("data-u") ?? "";

    chapter.url = urlWithoutDomain(dataU ? fromUtf8(Base64.decode(dataU)) : (urlElement?.attr("href") ?? ""));

    chapter.name = element.selectFirst(".ch-title, .epl-num, .chapternum")?.text() ?? "";
    const date = element.selectFirst(".ch-date, .chapterdate")?.text();
    chapter.date_upload = date != null ? this.parseChapterDate(date) : 0;
    return chapter;
  }
}

/** Jsoup's Element.closest(): this element or its nearest ancestor matching `css`. */
function closest(element: Element, css: string): Element | null {
  for (let e: Element | null = element; e; e = e.parent()) if (e.tagName() && e.is(css)) return e;
  return null;
}
