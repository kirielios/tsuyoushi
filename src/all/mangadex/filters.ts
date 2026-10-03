// Port of keiyoushi/extensions-source src/all/mangadex/MangaDexFilters.kt
import { Filter, FilterList, type HttpUrl, type HttpUrlBuilder, type SharedPreferences } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";
import { MDConstants, MangaDexIntl } from "./constants.ts";
import { ContentRatingDto, PublicationDemographicDto, StatusDto } from "./dto.ts";

interface UrlQueryFilter {
  addQueryParameter(url: HttpUrlBuilder, dexLang: string): void;
}
const isUrlQueryFilter = (f: Filter): f is Filter & UrlQueryFilter => typeof (f as unknown as UrlQueryFilter).addQueryParameter === "function";

class HasAvailableChaptersFilter extends Filter.CheckBox implements UrlQueryFilter {
  constructor(intl: Intl) {
    super(intl.get("has_available_chapters"));
  }
  addQueryParameter(url: HttpUrlBuilder, dexLang: string) {
    if (this.state) {
      url.addQueryParameter("hasAvailableChapters", "true");
      url.addQueryParameter("availableTranslatedLanguage[]", dexLang);
    }
  }
}

class OriginalLanguage extends Filter.CheckBox {
  constructor(
    name: string,
    readonly isoCode: string,
    state = false,
  ) {
    super(name, state);
  }
}
class OriginalLanguageList extends Filter.Group<OriginalLanguage> implements UrlQueryFilter {
  constructor(intl: Intl, originalLanguage: OriginalLanguage[]) {
    super(intl.get("original_language"), originalLanguage);
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    this.state
      .filter((it) => it.state)
      .forEach((lang) => {
        // dex has zh and zh-hk for chinese manhua
        if (lang.isoCode === MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE) {
          url.addQueryParameter("originalLanguage[]", MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE_HK);
        }
        url.addQueryParameter("originalLanguage[]", lang.isoCode);
      });
  }
}

class ValueCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

class ValueCheckBoxList extends Filter.Group<ValueCheckBox> implements UrlQueryFilter {
  constructor(
    name: string,
    items: ValueCheckBox[],
    private readonly param: string,
  ) {
    super(name, items);
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    this.state.filter((it) => it.state).forEach((it) => url.addQueryParameter(this.param, it.value));
  }
}

// ContentRating / ContentRatingList, Demographic / DemographicList, Status / StatusList
class ContentRatingList extends ValueCheckBoxList {
  constructor(intl: Intl, contentRating: ValueCheckBox[]) {
    super(intl.get("content_rating"), contentRating, "contentRating[]");
  }
}
class DemographicList extends ValueCheckBoxList {
  constructor(intl: Intl, demographics: ValueCheckBox[]) {
    super(intl.get("publication_demographic"), demographics, "publicationDemographic[]");
  }
}
class StatusList extends ValueCheckBoxList {
  constructor(intl: Intl, status: ValueCheckBox[]) {
    super(intl.get("status"), status, "status[]");
  }
}

interface Sortable {
  title: string;
  value: string;
}

export class SortFilter extends Filter.Sort implements UrlQueryFilter {
  constructor(
    intl: Intl,
    private readonly sortables: Sortable[],
  ) {
    super(
      intl.get("sort"),
      sortables.map((it) => it.title),
      { index: 5, ascending: false },
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    if (this.state != null) {
      const query = this.sortables[this.state.index].value;
      const value = this.state.ascending ? "asc" : "desc";
      url.addQueryParameter(`order[${query}]`, value);
    }
  }
}

class DaysSinceFilter extends Filter.Select<string> implements UrlQueryFilter {
  constructor(
    name: string,
    private readonly queryParam: string,
    private readonly options: [string, number][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    const days = this.options[this.state][1];
    if (!(days > 0)) return;
    const hour = 3_600_000;
    const since = Math.floor((Date.now() - days * 86_400_000) / hour) * hour;
    url.addQueryParameter(this.queryParam, MDConstants.dateFormatterNoOffset(since));
  }
}

export class Tag extends Filter.TriState {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}

class TagList extends Filter.Group<Tag> implements UrlQueryFilter {
  constructor(collection: string, tags: Tag[]) {
    super(collection, tags);
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    this.state.forEach((tag) => {
      if (tag.isIncluded()) url.addQueryParameter("includedTags[]", tag.id);
      else if (tag.isExcluded()) url.addQueryParameter("excludedTags[]", tag.id);
    });
  }
}

interface TagMode {
  title: string;
  value: string;
}

/** Filter.Select<TagMode>: the app shows the titles (TagMode.toString()), the values stay here. */
class TagInclusionMode extends Filter.Select<string> implements UrlQueryFilter {
  constructor(
    intl: Intl,
    private readonly modes: TagMode[],
  ) {
    super(
      intl.get("included_tags_mode"),
      modes.map((it) => it.title),
      0,
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    url.addQueryParameter("includedTagsMode", this.modes[this.state].value);
  }
}

class TagExclusionMode extends Filter.Select<string> implements UrlQueryFilter {
  constructor(
    intl: Intl,
    private readonly modes: TagMode[],
  ) {
    super(
      intl.get("excluded_tags_mode"),
      modes.map((it) => it.title),
      1,
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _dexLang: string) {
    url.addQueryParameter("excludedTagsMode", this.modes[this.state].value);
  }
}

class TagsFilter extends Filter.Group<Filter> implements UrlQueryFilter {
  constructor(intl: Intl, innerFilters: FilterList) {
    super(intl.get("tags_mode"), innerFilters);
  }
  addQueryParameter(url: HttpUrlBuilder, dexLang: string) {
    this.state.filter(isUrlQueryFilter).forEach((filter) => filter.addQueryParameter(url, dexLang));
  }
}

export class MangaDexFilters {
  getMDFilterList(preferences: SharedPreferences, dexLang: string, intl: Intl): FilterList {
    return FilterList(
      new HasAvailableChaptersFilter(intl),
      new OriginalLanguageList(intl, this.getOriginalLanguage(preferences, dexLang, intl)),
      new ContentRatingList(intl, this.getContentRating(preferences, dexLang, intl)),
      new DemographicList(intl, this.getDemographics(intl)),
      new StatusList(intl, this.getStatus(intl)),
      new SortFilter(intl, this.getSortables(intl)),
      new DaysSinceFilter(intl.get("created_at"), "createdAtSince", [
        [intl.get("created_at_any"), 0],
        [intl.get("created_at_day"), 1],
        [intl.get("created_at_week"), 7],
        [intl.get("created_at_month"), 30],
        [intl.get("created_at_year"), 365],
      ]),
      new TagsFilter(intl, this.getTagFilters(intl)),
      new TagList(intl.get("content"), this.getContents(intl)),
      new TagList(intl.get("format"), this.getFormats(intl)),
      new TagList(intl.get("genre"), this.getGenres(intl)),
      new TagList(intl.get("theme"), this.getThemes(intl)),
    );
  }

  private getOriginalLanguage(preferences: SharedPreferences, dexLang: string, intl: Intl): OriginalLanguage[] {
    const originalLanguages = preferences.getStringSet(MDConstants.getOriginalLanguagePrefKey(dexLang), []);
    return [
      new OriginalLanguage(
        intl.format("original_language_filter_japanese", intl.languageDisplayName(MangaDexIntl.JAPANESE)),
        MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_JAPANESE,
        originalLanguages.includes(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_JAPANESE),
      ),
      new OriginalLanguage(
        intl.format("original_language_filter_chinese", intl.languageDisplayName(MangaDexIntl.CHINESE)),
        MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE,
        originalLanguages.includes(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE),
      ),
      new OriginalLanguage(
        intl.format("original_language_filter_korean", intl.languageDisplayName(MangaDexIntl.KOREAN)),
        MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_KOREAN,
        originalLanguages.includes(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_KOREAN),
      ),
    ];
  }

  private getContentRating(preferences: SharedPreferences, dexLang: string, intl: Intl): ValueCheckBox[] {
    const contentRatings = preferences.getStringSet(MDConstants.getContentRatingPrefKey(dexLang), MDConstants.contentRatingPrefDefaults);
    const item = (key: string, value: string, pref: string) => {
      const it = new ValueCheckBox(intl.get(key), value);
      it.state = contentRatings.includes(pref);
      return it;
    };
    return [
      item("content_rating_safe", ContentRatingDto.SAFE, MDConstants.CONTENT_RATING_PREF_VAL_SAFE),
      item("content_rating_suggestive", ContentRatingDto.SUGGESTIVE, MDConstants.CONTENT_RATING_PREF_VAL_SUGGESTIVE),
      item("content_rating_erotica", ContentRatingDto.EROTICA, MDConstants.CONTENT_RATING_PREF_VAL_EROTICA),
      item("content_rating_pornographic", ContentRatingDto.PORNOGRAPHIC, MDConstants.CONTENT_RATING_PREF_VAL_PORNOGRAPHIC),
    ];
  }

  private getDemographics(intl: Intl) {
    return [
      new ValueCheckBox(intl.get("publication_demographic_none"), PublicationDemographicDto.NONE),
      new ValueCheckBox(intl.get("publication_demographic_shounen"), PublicationDemographicDto.SHOUNEN),
      new ValueCheckBox(intl.get("publication_demographic_shoujo"), PublicationDemographicDto.SHOUJO),
      new ValueCheckBox(intl.get("publication_demographic_seinen"), PublicationDemographicDto.SEINEN),
      new ValueCheckBox(intl.get("publication_demographic_josei"), PublicationDemographicDto.JOSEI),
    ];
  }

  private getStatus(intl: Intl) {
    return [
      new ValueCheckBox(intl.get("status_ongoing"), StatusDto.ONGOING),
      new ValueCheckBox(intl.get("status_completed"), StatusDto.COMPLETED),
      new ValueCheckBox(intl.get("status_hiatus"), StatusDto.HIATUS),
      new ValueCheckBox(intl.get("status_cancelled"), StatusDto.CANCELLED),
    ];
  }

  private getSortables(intl: Intl): Sortable[] {
    return [
      { title: intl.get("sort_alphabetic"), value: "title" },
      { title: intl.get("sort_chapter_uploaded_at"), value: "latestUploadedChapter" },
      { title: intl.get("sort_number_of_follows"), value: "followedCount" },
      { title: intl.get("sort_content_created_at"), value: "createdAt" },
      { title: intl.get("sort_content_info_updated_at"), value: "updatedAt" },
      { title: intl.get("sort_relevance"), value: "relevance" },
      { title: intl.get("sort_year"), value: "year" },
      { title: intl.get("sort_rating"), value: "rating" },
    ];
  }

  private tags(intl: Intl, list: [string, string][]): Tag[] {
    return this.sortIfTranslated(
      list.map(([id, key]) => new Tag(id, intl.get(key))),
      intl,
    );
  }

  private getContents(intl: Intl): Tag[] {
    return this.tags(intl, [
      ["b29d6a3d-1569-4e7a-8caf-7557bc92cd5d", "content_gore"],
      ["97893a4c-12af-4dac-b6be-0dffb353568e", "content_sexual_violence"],
    ]);
  }

  private getFormats(intl: Intl): Tag[] {
    return this.tags(intl, [
      ["b11fda93-8f1d-4bef-b2ed-8803d3733170", "format_yonkoma"],
      ["f4122d1c-3b44-44d0-9936-ff7502c39ad3", "format_adaptation"],
      ["51d83883-4103-437c-b4b1-731cb73d786c", "format_anthology"],
      ["0a39b5a1-b235-4886-a747-1d05d216532d", "format_award_winning"],
      ["b13b2a48-c720-44a9-9c77-39c9979373fb", "format_doujinshi"],
      ["7b2ce280-79ef-4c09-9b58-12b7c23a9b78", "format_fan_colored"],
      ["f5ba408b-0e7a-484d-8d49-4e9125ac96de", "format_full_color"],
      ["3e2b8dae-350e-4ab8-a8ce-016e844b9f0d", "format_long_strip"],
      ["320831a8-4026-470b-94f6-8353740e6f04", "format_official_colored"],
      ["0234a31e-a729-4e28-9d6a-3f87c4966b9e", "format_oneshot"],
      ["891cf039-b895-47f0-9229-bef4c96eccd4", "format_user_created"],
      ["e197df38-d0e7-43b5-9b09-2842d0c326dd", "format_web_comic"],
    ]);
  }

  private getGenres(intl: Intl): Tag[] {
    return this.tags(intl, [
      ["391b0423-d847-456f-aff0-8b0cfc03066b", "genre_action"],
      ["87cc87cd-a395-47af-b27a-93258283bbc6", "genre_adventure"],
      ["5920b825-4181-4a17-beeb-9918b0ff7a30", "genre_boys_love"],
      ["4d32cc48-9f00-4cca-9b5a-a839f0764984", "genre_comedy"],
      ["5ca48985-9a9d-4bd8-be29-80dc0303db72", "genre_crime"],
      ["b9af3a63-f058-46de-a9a0-e0c13906197a", "genre_drama"],
      ["cdc58593-87dd-415e-bbc0-2ec27bf404cc", "genre_fantasy"],
      ["a3c67850-4684-404e-9b7f-c69850ee5da6", "genre_girls_love"],
      ["33771934-028e-4cb3-8744-691e866a923e", "genre_historical"],
      ["cdad7e68-1419-41dd-bdce-27753074a640", "genre_horror"],
      ["ace04997-f6bd-436e-b261-779182193d3d", "genre_isekai"],
      ["81c836c9-914a-4eca-981a-560dad663e73", "genre_magical_girls"],
      ["50880a9d-5440-4732-9afb-8f457127e836", "genre_mecha"],
      ["c8cbe35b-1b2b-4a3f-9c37-db84c4514856", "genre_medical"],
      ["ee968100-4191-4968-93d3-f82d72be7e46", "genre_mystery"],
      ["b1e97889-25b4-4258-b28b-cd7f4d28ea9b", "genre_philosophical"],
      ["423e2eae-a7a2-4a8b-ac03-a8351462d71d", "genre_romance"],
      ["256c8bd9-4904-4360-bf4f-508a76d67183", "genre_sci_fi"],
      ["e5301a23-ebd9-49dd-a0cb-2add944c7fe9", "genre_slice_of_life"],
      ["69964a64-2f90-4d33-beeb-f3ed2875eb4c", "genre_sports"],
      ["7064a261-a137-4d3a-8848-2d385de3a99c", "genre_superhero"],
      ["07251805-a27e-4d59-b488-f0bfbec15168", "genre_thriller"],
      ["f8f62932-27da-4fe4-8ee1-6779a8c5edba", "genre_tragedy"],
      ["acc803a4-c95a-4c22-86fc-eb6b582d82a2", "genre_wuxia"],
    ]);
  }

  private getThemes(intl: Intl): Tag[] {
    return this.tags(intl, [
      ["e64f6742-c834-471d-8d72-dd51fc02b835", "theme_aliens"],
      ["3de8c75d-8ee3-48ff-98ee-e20a65c86451", "theme_animals"],
      ["ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869", "theme_cooking"],
      ["9ab53f92-3eed-4e9b-903a-917c86035ee3", "theme_crossdressing"],
      ["da2d50ca-3018-4cc0-ac7a-6b7d472a29ea", "theme_delinquents"],
      ["39730448-9a5f-48a2-85b0-a70db87b1233", "theme_demons"],
      ["2bd2e8d0-f146-434a-9b51-fc9ff2c5fe6a", "theme_gender_swap"],
      ["3bb26d85-09d5-4d2e-880c-c34b974339e9", "theme_ghosts"],
      ["fad12b5e-68ba-460e-b933-9ae8318f5b65", "theme_gyaru"],
      ["aafb99c1-7f60-43fa-b75f-fc9502ce29c7", "theme_harem"],
      ["5bd0e105-4481-44ca-b6e7-7544da56b1a3", "theme_incest"],
      ["2d1f5d56-a1e5-4d0d-a961-2193588b08ec", "theme_loli"],
      ["85daba54-a71c-4554-8a28-9901a8b0afad", "theme_mafia"],
      ["a1f53773-c69a-4ce5-8cab-fffcd90b1565", "theme_magic"],
      ["799c202e-7daa-44eb-9cf7-8a3c0441531e", "theme_martial_arts"],
      ["ac72833b-c4e9-4878-b9db-6c8a4a99444a", "theme_military"],
      ["dd1f77c5-dea9-4e2b-97ae-224af09caf99", "theme_monster_girls"],
      ["36fd93ea-e8b8-445e-b836-358f02b3d33d", "theme_monsters"],
      ["f42fbf9e-188a-447b-9fdc-f19dc1e4d685", "theme_music"],
      ["489dd859-9b61-4c37-af75-5b18e88daafc", "theme_ninja"],
      ["92d6d951-ca5e-429c-ac78-451071cbf064", "theme_office_workers"],
      ["df33b754-73a3-4c54-80e6-1a74a8058539", "theme_police"],
      ["9467335a-1b83-4497-9231-765337a00b96", "theme_post_apocalyptic"],
      ["3b60b75c-a2d7-4860-ab56-05f391bb889c", "theme_psychological"],
      ["0bc90acb-ccc1-44ca-a34a-b9f3a73259d0", "theme_reincarnation"],
      ["65761a2a-415e-47f3-bef2-a9dababba7a6", "theme_reverse_harem"],
      ["81183756-1453-4c81-aa9e-f6e1b63be016", "theme_samurai"],
      ["caaa44eb-cd40-4177-b930-79d3ef2afe87", "theme_school_life"],
      ["ddefd648-5140-4e5f-ba18-4eca4071d19b", "theme_shota"],
      ["eabc5b4c-6aff-42f3-b657-3e90cbd00b75", "theme_supernatural"],
      ["5fff9cde-849c-4d78-aab0-0d52b2ee1d25", "theme_survival"],
      ["292e862b-2d17-4062-90a2-0356caa4ae27", "theme_time_travel"],
      ["31932a7e-5b8e-49a6-9f12-2afa39dc544c", "theme_traditional_games"],
      ["d7d1730f-6eb0-4ba6-9437-602cac38664c", "theme_vampires"],
      ["9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8", "theme_video_games"],
      ["d14322ac-4d6f-4e9b-afd9-629d5f4d8a41", "theme_villainess"],
      ["8c86611e-fab7-4986-9dec-d1a2f44acdd5", "theme_virtual_reality"],
      ["631ef465-9aba-4afb-b0fc-ea10efe274a8", "theme_zombies"],
    ]);
  }

  // to get all tags from dex https://api.mangadex.org/manga/tag
  getTags(intl: Intl): Tag[] {
    return [...this.getContents(intl), ...this.getFormats(intl), ...this.getGenres(intl), ...this.getThemes(intl)];
  }

  private getTagModes(intl: Intl): TagMode[] {
    return [
      { title: intl.get("mode_and"), value: "AND" },
      { title: intl.get("mode_or"), value: "OR" },
    ];
  }

  private getTagFilters(intl: Intl): FilterList {
    return FilterList(new TagInclusionMode(intl, this.getTagModes(intl)), new TagExclusionMode(intl, this.getTagModes(intl)));
  }

  addFiltersToUrl(url: HttpUrlBuilder, filters: FilterList, dexLang: string): HttpUrl {
    filters.filter(isUrlQueryFilter).forEach((filter) => filter.addQueryParameter(url, dexLang));
    return url.build();
  }

  private sortIfTranslated(tags: Tag[], intl: Intl): Tag[] {
    if (intl.chosenLanguage === MangaDexIntl.ENGLISH) return tags;
    return [...tags].sort((a, b) => intl.collator.compare(a.name, b.name));
  }
}
