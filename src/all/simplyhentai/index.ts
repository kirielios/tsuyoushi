// Port of keiyoushi/extensions-source src/all/simplyhentai/SimplyHentai.kt
import { EditTextPreference, FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, tryParseInstant, type PreferenceScreen } from "../../../sdk/index.ts";
import { shDataPath, toSManga, type SHAlbum, type SHAlbumPages, type SHDataAlbum, type SHList, type SHWrapper } from "./dto.ts";
import { ArtistsFilter, CharactersFilter, Note, SeriesFilter, SortFilter, TagsFilter, TranslatorsFilter } from "./filters.ts";

const apiUrl = "https://api.simply-hentai.com/v3";

export default class SimplyHentai extends KeiSource {
  private get langName(): string {
    switch (this.lang) {
      case "en":
        return "english";
      case "ja":
        return "japanese";
      case "zh":
        return "chinese";
      case "ko":
        return "korean";
      case "es":
        return "spanish";
      case "ru":
        return "russian";
      case "fr":
        return "french";
      case "de":
        return "german";
      case "it":
        return "italian";
      case "pl":
        return "polish";
      default:
        return this.lang;
    }
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getLanguageList(page, null);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getLanguageList(page, "newest");
  }

  private async getLanguageList(page: number, sort: string | null): Promise<MangasPage> {
    const url = HttpUrl.parse(`${apiUrl}/tag/${this.langName}`).newBuilder();
    url.addQueryParameter("type", "language");
    url.addQueryParameter("page", String(page));
    if (sort != null) url.addQueryParameter("sort", sort);

    const result = (await this.client.get(url.build().toString())).parseAs<SHList<SHDataAlbum>>();
    return new MangasPage(result.data.albums.map(toSManga), result.pagination.next != null);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(`${apiUrl}/search/complex`).newBuilder();
    url.addQueryParameter("query", query);
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("blacklist", this.blacklist);
    url.addQueryParameter("filter[language][0]", this.langName.replace(/^./, (c) => c.toUpperCase()));
    for (const filter of filters) {
      if (filter instanceof SortFilter) url.addQueryParameter("sort", filter.orders[filter.state]);
      else if (filter instanceof SeriesFilter) {
        const v = filter.value;
        if (v != null) url.addQueryParameter("filter[series_title][0]", v);
      } else if (filter instanceof TagsFilter) filter.value?.forEach((tag, idx) => url.addQueryParameter(`filter[tags][${idx}]`, tag.trim()));
      else if (filter instanceof ArtistsFilter) filter.value?.forEach((tag, idx) => url.addQueryParameter(`filter[artists][${idx}]`, tag.trim()));
      else if (filter instanceof TranslatorsFilter) filter.value?.forEach((tag, idx) => url.addQueryParameter(`filter[translators][${idx}]`, tag.trim()));
      else if (filter instanceof CharactersFilter) filter.value?.forEach((tag, idx) => url.addQueryParameter(`filter[characters][${idx}]`, tag.trim()));
    }

    const result = (await this.client.get(url.build().toString())).parseAs<SHList<SHWrapper[]>>();
    return new MangasPage(
      result.data.map((it) => toSManga(it.object)),
      result.pagination.next != null,
    );
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const album = (await this.client.get(`${apiUrl}/manga/${manga.url.split("/")[2]}`)).parseAs<SHAlbum>().data;

    manga.url = shDataPath(album);
    manga.title = album.title;
    let description = "";
    if (album.description != null && album.description.length > 0) description += `${album.description}\n\n`;
    description += `Series: ${album.series.title}\n`;
    description += `Characters: ${album.characters.map((it) => it.title).join(", ")}`;
    manga.description = description;
    manga.thumbnail_url = album.preview.sizes.thumb;
    manga.genre = album.tags.map((it) => it.title).join(", ");
    manga.artist = album.artists.map((it) => it.title).join(", ");
    manga.author = manga.artist;

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = `${shDataPath(album)}/all-pages`;
    chapter.scanlator = album.translators.map((it) => it.title).join(", ");
    chapter.date_upload = tryParseInstant(album.created_at);

    return new SMangaUpdate(manga, [chapter]);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const result = (await this.client.get(`${apiUrl}/manga/${chapter.url.split("/")[2]}/pages`)).parseAs<SHAlbumPages>();
    return result.data.pages.map((it) => new Page(it.page_num, "", it.sizes.full));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [
      new SortFilter(),
      new SeriesFilter(),
      new Note("tags"),
      new TagsFilter(),
      new Note("artists"),
      new ArtistsFilter(),
      new Note("translators"),
      new TranslatorsFilter(),
      new Note("characters"),
      new CharactersFilter(),
    ];
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new EditTextPreference(screen.context);
    pref.key = "blacklist";
    pref.title = "Blacklist";
    pref.summary = "Separate multiple tags with commas (,)";
    // the change listener only stores the value under "blacklist"; the app's text preference does that itself
    screen.addPreference(pref);
  }

  private get blacklist(): string {
    return this.preferences.getString("blacklist", "")!;
  }
}
