// Port of keiyoushi/extensions-source lib-multisrc/madara/Madara.kt
import { Filter, FilterList, MangasPage, type SManga } from "../../sdk/index.ts";
import { MadaraBase } from "./base.ts";
import { AdultFilter, GenreConditionFilter, GenreList, SortFilter, StatusFilter, TextFilter, genreRoutes, type GenreRoute } from "./filters.ts";

enum BrowseMode {
  Popular,
  Latest,
  Search,
}

export abstract class Madara extends MadaraBase {
  protected pageSize = 25;

  override getPopularManga(page: number) {
    return this.ajaxList(page, BrowseMode.Popular);
  }
  override getLatestUpdates(page: number) {
    return this.ajaxList(page, BrowseMode.Latest);
  }
  override getSearchMangaList(page: number, query: string, filters: FilterList) {
    return this.ajaxList(page, BrowseMode.Search, query, filters);
  }
  override getHomeUrl() {
    return `${this.baseUrl}/${this.mangaSubString}/?m_orderby=views`;
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = genreRoutes(data);
    const list: Filter[] = [
      new TextFilter(this.intl.get("author_filter_title"), "wp-manga-author"),
      new TextFilter(this.intl.get("artist_filter_title"), "wp-manga-artist"),
      new TextFilter(this.intl.get("year_filter_title"), "wp-manga-release"),
      new StatusFilter(this.intl.get("status_filter_title"), this.statusFilterOptions),
      new SortFilter(this.intl.get("order_by_filter_title"), this.orderByFilterOptions),
      new AdultFilter(this.intl.get("adult_content_filter_title"), this.adultFilterOptions),
    ];
    if (genres.length) {
      list.push(
        new Filter.Separator(),
        new Filter.Header(this.intl.get("genre_filter_header")),
        new GenreConditionFilter(this.intl.get("genre_condition_filter_title"), this.genreConditionFilterOptions),
        new GenreList(this.intl.get("genre_filter_title"), genres),
      );
    }
    return FilterList(...list);
  }

  protected ajaxTemplate = "madara-core/content/content-archive";

  private async ajaxList(page: number, mode: BrowseMode, query = "", filters: FilterList = FilterList()): Promise<MangasPage> {
    const body = new URLSearchParams();
    body.append("action", "madara_load_more");
    body.append("page", String(page - 1));
    body.append("template", this.ajaxTemplate);
    body.append("vars[paged]", "1");
    body.append("vars[template]", "archive");
    body.append("vars[posts_per_page]", String(this.pageSize));
    body.append("vars[post_type]", "wp-manga");
    body.append("vars[post_status]", "publish");
    body.append("vars[manga_archives_item_layout]", "big_thumbnail");
    if (this.filterNonMangaItems) {
      body.append("vars[meta_query][0][key]", "_wp_manga_chapter_type");
      body.append("vars[meta_query][0][value]", "manga");
    }
    switch (mode) {
      case BrowseMode.Popular:
        sort(body, "_wp_manga_views");
        break;
      case BrowseMode.Latest:
        sort(body, "_latest_update");
        break;
      case BrowseMode.Search:
        this.addFilters(body, query, filters, this.filterNonMangaItems ? 1 : 0);
    }
    const mangas = this.parseArchive((await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, body)).asJsoup());
    return new MangasPage(mangas, mangas.length === this.pageSize);
  }

  private addFilters(body: URLSearchParams, query: string, filters: FilterList, initialMetaQueryIndex: number) {
    if (query.trim()) body.append("vars[s]", query);
    let metaQueryIndex = initialMetaQueryIndex;
    let taxonomyQueryIndex = 0;
    const genres = (filters.find((f): f is GenreList => f instanceof GenreList)?.state ?? []).filter((it) => it.state).map((it) => it.slug);
    for (const filter of filters) {
      if (filter instanceof TextFilter) {
        if (filter.state.trim()) {
          body.append(`vars[tax_query][${taxonomyQueryIndex}][taxonomy]`, filter.taxonomy);
          body.append(`vars[tax_query][${taxonomyQueryIndex}][field]`, "name");
          body.append(`vars[tax_query][${taxonomyQueryIndex}][terms]`, filter.state);
          taxonomyQueryIndex++;
        }
      } else if (filter instanceof StatusFilter) {
        const states = filter.state.filter((it) => it.state).map((it) => it.slug);
        if (states.length) {
          body.append(`vars[meta_query][${metaQueryIndex}][key]`, "_wp_manga_status");
          body.append(`vars[meta_query][${metaQueryIndex}][compare]`, "IN");
          states.forEach((state, i) => body.append(`vars[meta_query][${metaQueryIndex}][value][${i}]`, state));
          metaQueryIndex++;
        }
      } else if (filter instanceof SortFilter) {
        switch (filter.key()) {
          case "latest":
            sort(body, "_latest_update");
            break;
          case "alphabet":
            body.append("vars[orderby]", "post_title");
            body.append("vars[order]", "ASC");
            break;
          case "rating":
            body.append("vars[meta_query][query_average_reviews][key]", "_manga_avarage_reviews");
            body.append("vars[meta_query][query_average_reviews][compare]", "EXISTS");
            body.append("vars[meta_query][query_total_reviews][key]", "_manga_total_votes");
            body.append("vars[meta_query][query_total_reviews][compare]", "EXISTS");
            body.append("vars[orderby][query_average_reviews]", "DESC");
            body.append("vars[orderby][query_total_reviews]", "DESC");
            break;
          case "trending":
            sort(body, "_wp_manga_week_views_value");
            break;
          case "views":
            sort(body, "_wp_manga_views");
            break;
          case "new-manga":
            body.append("vars[orderby]", "date");
            body.append("vars[order]", "DESC");
        }
      } else if (filter instanceof AdultFilter) {
        if (filter.state !== 0) {
          body.append(`vars[meta_query][${metaQueryIndex}][key]`, "manga_adult_content");
          body.append(`vars[meta_query][${metaQueryIndex}][compare]`, filter.state === 1 ? "not exists" : "exists");
          metaQueryIndex++;
        }
      } else if (filter instanceof GenreConditionFilter) {
        if (filter.state === 1 && genres.length) body.append(`vars[tax_query][${taxonomyQueryIndex}][operation]`, "AND");
      } else if (filter instanceof GenreList) {
        if (genres.length) {
          body.append(`vars[tax_query][${taxonomyQueryIndex}][taxonomy]`, "wp-manga-genre");
          body.append(`vars[tax_query][${taxonomyQueryIndex}][field]`, "slug");
          genres.forEach((slug, i) => body.append(`vars[tax_query][${taxonomyQueryIndex}][terms][${i}]`, slug));
        }
      }
    }
  }

  protected override async fetchRelatedMangaListByGenres(id: string, genres: GenreRoute[]): Promise<SManga[]> {
    const body = new URLSearchParams();
    body.append("action", "madara_load_more");
    body.append("page", "0");
    body.append("template", this.ajaxTemplate);
    body.append("vars[posts_per_page]", String(this.pageSize));
    body.append("vars[template]", "archive");
    body.append("vars[post_type]", "wp-manga");
    body.append("vars[post_status]", "publish");
    body.append("vars[orderby]", "rand");
    body.append("vars[sidebar]", "right");
    body.append("vars[manga_archives_item_layout]", "big_thumbnail");
    body.append("vars[post__not_in][0]", id);
    body.append("vars[tax_query][0][taxonomy]", "wp-manga-genre");
    body.append("vars[tax_query][0][field]", "slug");
    genres.forEach((genre, i) => body.append(`vars[tax_query][0][terms][${i}]`, genre.slug));
    return this.parseArchive((await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, body)).asJsoup());
  }
}

/** FormBody.Builder.sort(key) */
function sort(body: URLSearchParams, key: string) {
  body.append("vars[orderby]", "meta_value_num");
  body.append("vars[meta_key]", key);
  body.append("vars[order]", "DESC");
}
