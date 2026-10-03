// Port of keiyoushi/extensions-source lib-multisrc/madara/MadaraNoAjax.kt
import { FilterList, MangasPage, SManga, notBlank, substringAfter, substringBefore } from "../../sdk/index.ts";
import { MadaraBase, SearchCard } from "./base.ts";
import { SingleGenreFilter, SortFilter, genreRoutes, type GenreRoute } from "./filters.ts";
import type { Response } from "../../sdk/network.ts";

const PAGE_SIZE = 25;

/** HttpUrl.Builder.addPathSegments("page/2/") on a URL whose path may or may not end in "/". */
function addPathSegments(url: URL, segments: string) {
  url.pathname = url.pathname.replace(/\/?$/, "/") + segments;
}

export abstract class MadaraNoAjax extends MadaraBase {
  override getPopularManga(page: number) {
    return this.archivePage(page, "views");
  }
  override getLatestUpdates(page: number) {
    return this.archivePage(page, "latest");
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = genreRoutes(data);
    const list = FilterList(new SortFilter(this.intl.get("order_by_filter_title"), this.orderByFilterOptions));
    if (genres.length) list.push(new SingleGenreFilter(this.intl.get("genre_filter_title"), this.intl.get("adult_content_filter_all"), genres));
    return list;
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genre = filters.find((f): f is SingleGenreFilter => f instanceof SingleGenreFilter)?.route();
    const sort = filters.find((f): f is SortFilter => f instanceof SortFilter)?.key() ?? "";
    if (genre != null) return this.archivePage(page, sort, genre.path, query);
    return query.trim() ? this.htmlSearch(page, query) : this.archivePage(page, sort);
  }

  protected nextPageSelector() {
    return "div.nav-previous, a.nextpostslink, #navigation-ajax";
  }

  protected orderQueryParameter = "m_orderby";
  protected searchQueryParameter = "s";

  protected archiveUrlBuilder(page: number, order: string, path: string, query: string): URL {
    const url = new URL(path, this.baseUrl);
    if (page > 1) addPathSegments(url, `page/${page}/`);
    if (order.trim()) url.searchParams.append(this.orderQueryParameter, order);
    if (query.trim()) url.searchParams.append(this.searchQueryParameter, query);
    return url;
  }

  protected async archivePage(page: number, order: string, path = `/${this.mangaSubString}/`, query = ""): Promise<MangasPage> {
    const document = (await this.client.get(this.archiveUrlBuilder(page, order, path, query))).asJsoup();
    return new MangasPage(this.parseArchive(document), document.selectFirst(this.nextPageSelector()) != null);
  }

  protected searchUrlBuilder(page: number, query: string): URL {
    const url = new URL(this.baseUrl);
    if (page > 1) addPathSegments(url, `page/${page}/`);
    url.searchParams.append(this.searchQueryParameter, query);
    url.searchParams.append("post_type", "wp-manga");
    return url;
  }

  private async htmlSearch(page: number, query: string): Promise<MangasPage> {
    if (page > 1 && this.supportsPostId) return new MangasPage([], false);

    const document = (await this.client.get(this.searchUrlBuilder(page, query))).asJsoup();
    const hasNextPage = !this.supportsPostId && document.selectFirst(this.nextPageSelector()) != null;

    const archiveMangas = this.parseArchive(document);
    if (archiveMangas.length) return new MangasPage(archiveMangas, hasNextPage);

    const cards = this.parseSearchCards(document);
    const ids = await this.rssIds(
      query,
      cards.map((it) => it.path),
    );
    const toManga = (card: SearchCard, id: string) => {
      const manga = SManga.create();
      manga.url = id;
      manga.title = card.title;
      manga.thumbnail_url = card.thumbnail ?? undefined;
      manga.memo = this.mangaMemo(card.path, []);
      return manga;
    };
    if (!ids.complete) {
      const resolved = await Promise.all(cards.map(async (card) => [card, await this.resolvePostId(new URL(card.path, this.baseUrl))] as const));
      return new MangasPage(
        resolved.flatMap(([card, id]) => (id ? [toManga(card, id)] : [])),
        false,
      );
    }
    return new MangasPage(
      cards.flatMap((card) => (ids.values.has(card.path) ? [toManga(card, ids.values.get(card.path)!)] : [])),
      false,
    );
  }

  private async rssIds(query: string, needed: string[]): Promise<{ values: Map<string, string>; complete: boolean }> {
    const values = new Map<string, string>();
    for (let page = 1; page <= 20; page++) {
      const url = new URL(this.baseUrl);
      url.pathname = url.pathname.replace(/\/?$/, "/") + "feed";
      url.searchParams.append("post_type", "wp-manga");
      url.searchParams.append("s", query);
      url.searchParams.append("paged", String(page));
      let feed: Map<string, SearchCard>;
      try {
        feed = this.parseRss(await this.client.get(url));
      } catch {
        break;
      }
      for (const [id, card] of feed) values.set(card.path, id);
      if (needed.every((it) => values.has(it)) || feed.size === 0) break;
    }
    return { values, complete: needed.every((it) => values.has(it)) };
  }

  private parseRss(response: Response): Map<string, SearchCard> {
    const document = response.asXml();
    const out = new Map<string, SearchCard>();
    for (const item of document.select("item")) {
      const link = notBlank(item.selectFirst("link")?.text());
      if (!link) continue;
      let id: string | null = null;
      try {
        id = new URL(item.selectFirst("guid")?.text() ?? "").searchParams.get("p");
      } catch {
        id = null;
      }
      if (!id) continue;
      out.set(id, new SearchCard(item.selectFirst("title")!.text(), new URL(link).pathname, item.selectFirst("media\\:content")?.attr("url")));
    }
    return out;
  }

  private async resolvePostId(url: URL): Promise<string | null> {
    const head = await this.client.head(url, undefined, { ensureSuccess: false });
    for (const link of head.headerValues("Link")) {
      const id = shortlinkId(link);
      if (id) return id;
    }
    return this.docMangaId((await this.client.get(url)).asJsoup());
  }

  protected override async fetchRelatedMangaListByGenres(id: string, genres: GenreRoute[]): Promise<SManga[]> {
    const lists = await Promise.all(genres.map(async (genre) => (await this.archivePage(1, "", genre.path)).mangas));
    const groups = new Map<string, { manga: SManga; count: number; first: number }>();
    lists
      .flat()
      .filter((it) => it.url !== id)
      .forEach((manga, index) => {
        const g = groups.get(manga.url);
        if (g) g.count++;
        else groups.set(manga.url, { manga, count: 1, first: index });
      });
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .map((g) => g.manga)
      .slice(0, PAGE_SIZE);
  }
}

function shortlinkId(header: string): string | null {
  if (!/rel=shortlink|rel="shortlink"/i.test(header)) return null;
  try {
    return new URL(substringBefore(substringAfter(header, "<", ""), ">", "")).searchParams.get("p");
  } catch {
    return null;
  }
}
