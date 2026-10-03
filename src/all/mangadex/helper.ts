// Port of keiyoushi/extensions-source src/all/mangadex/MangaDexHelper.kt
import { SChapter, SManga, parseAs, toHttpUrl, tryParseInstant, type HttpClient, type Page } from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { MDConstants, MangaDexIntl } from "./constants.ts";
import {
  ContentRatingDto,
  StatusDto,
  ofType,
  type AggregateVolume,
  type AtHomeDto,
  type AuthorArtistAttributesDto,
  type ChapterDataDto,
  type CoverArtAttributesDto,
  type MangaAttributesDto,
  type MangaDataDto,
  type ScanlationGroupAttributes,
  type UserAttributes,
} from "./dto.ts";
import { MangaDexFilters } from "./filters.ts";
import { messages } from "./messages.ts";

const markdownLinksRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
const markdownItalicBoldRegex = /\*+\s*([^*]*)\s*\*+/g;
const markdownItalicRegex = /_+\s*([^_]*)\s*_+/g;
const titleSpecialCharactersRegex = /[^a-z0-9]+/g;
const trailingHyphenRegex = /-+$/;

/** Locale.forLanguageTag(tag).getDisplayName(inLocale) */
function displayName(tag: string, inLocale: string): string {
  try {
    return new globalThis.Intl.DisplayNames([inLocale], { type: "language" }).of(tag) ?? "";
  } catch {
    return "";
  }
}

export class MangaDexHelper {
  readonly mdFilters = new MangaDexFilters();

  readonly intl: Intl;

  constructor(
    lang: string,
    /** Parser.unescapeEntities(s, false) */
    private readonly unescapeEntities: (s: string) => string,
  ) {
    // createMessageFileName: es-419 reads the es file and pt the pt-BR one
    this.intl = new Intl({
      language: lang,
      baseLanguage: MangaDexIntl.ENGLISH,
      availableLanguages: MangaDexIntl.AVAILABLE_LANGS,
      messages: { ...messages, [MangaDexIntl.SPANISH_LATAM]: messages[MangaDexIntl.SPANISH], [MangaDexIntl.PORTUGUESE]: messages[MangaDexIntl.BRAZILIAN_PORTUGUESE] },
    });
  }

  /** Gets the UUID from the url */
  getUUIDFromUrl(url: string) {
    return url.slice(url.lastIndexOf("/") + 1);
  }

  /** Get chapters for manga (aka manga/$id/feed endpoint) */
  getChapterEndpoint(mangaId: string, offset: number, langCode: string) {
    return toHttpUrl(`${MDConstants.API_MANGA_URL}/${mangaId}/feed`)
      .newBuilder()
      .addQueryParameter("includes[]", MDConstants.SCANLATION_GROUP)
      .addQueryParameter("includes[]", MDConstants.USER)
      .addQueryParameter("limit", "500")
      .addQueryParameter("offset", String(offset))
      .addQueryParameter("translatedLanguage[]", langCode)
      .addQueryParameter("order[volume]", "desc")
      .addQueryParameter("order[chapter]", "desc")
      .addQueryParameter("includeFuturePublishAt", "0")
      .addQueryParameter("includeEmptyPages", "0")
      .toString();
  }

  /** Check if the manga url is a valid uuid */
  containsUuid(url: string) {
    return MDConstants.uuidRegex.test(url);
  }

  /** Check if the string is a valid uuid */
  isUuid(text: string) {
    return new RegExp(`^(?:${MDConstants.uuidRegex.source})$`).test(text);
  }

  /** Get the manga offset pages are 1 based, so subtract 1 */
  getMangaListOffset(page: number) {
    return String(MDConstants.MANGA_LIMIT * (page - 1));
  }

  /** Get the latest chapter offset pages are 1 based, so subtract 1 */
  getLatestChapterOffset(page: number) {
    return String(MDConstants.LATEST_CHAPTER_LIMIT * (page - 1));
  }

  /** Remove any HTML characters in manga or chapter name to actual characters. For example &hearts; will show ♥. */
  private removeEntities(s: string) {
    return this.unescapeEntities(s);
  }

  /** Remove any HTML characters in description to actual characters. It also removes Markdown syntax for links, italic and bold. */
  private removeEntitiesAndMarkdown(s: string) {
    let t = this.removeEntities(s);
    const i = t.indexOf("\n---");
    if (i >= 0) t = t.slice(0, i);
    return t.replace(markdownLinksRegex, "$1").replace(markdownItalicBoldRegex, "$1").replace(markdownItalicRegex, "$1").trim();
  }

  /** Maps MangaDex status to Tachiyomi status. Adapted from the MangaDex handler from TachiyomiSY. */
  getPublicationStatus(attr: MangaAttributesDto, volumes: Record<string, AggregateVolume>): number {
    const chaptersList = Object.values(volumes)
      .flatMap((it) => Object.values(it.chapters))
      .map((it) => it.chapter);

    let tempStatus: number;
    switch (attr.status) {
      case StatusDto.ONGOING:
        tempStatus = SManga.ONGOING;
        break;
      case StatusDto.CANCELLED:
        tempStatus = SManga.CANCELLED;
        break;
      case StatusDto.COMPLETED:
        tempStatus = SManga.PUBLISHING_FINISHED;
        break;
      case StatusDto.HIATUS:
        tempStatus = SManga.ON_HIATUS;
        break;
      default:
        tempStatus = SManga.UNKNOWN;
    }

    const publishedOrCancelled = tempStatus === SManga.PUBLISHING_FINISHED || tempStatus === SManga.CANCELLED;

    const isOneShot = attr.tags.some((it) => it.id === MDConstants.TAG_ONE_SHOT_UUID) && !attr.tags.some((it) => it.id === MDConstants.TAG_ANTHOLOGY_UUID);

    if (attr.lastChapter != null && chaptersList.includes(attr.lastChapter) && publishedOrCancelled) return SManga.COMPLETED;
    if (isOneShot && volumes["none"]?.chapters?.["none"] != null) return SManga.COMPLETED;
    return tempStatus;
  }

  /** Chapter URL where we get the token, last request time. */
  private readonly tokenTracker = new Map<string, number>();

  /**
   * Check the token map to see if the MD@Home host is still valid. Returns the image URL; upstream builds the Request.
   * ponytail: the client has no HTTP cache, so USE_CACHE refreshes go to the network too.
   */
  async getValidImageUrlForPage(page: Page, headers: Headers, client: HttpClient): Promise<string> {
    const [host, tokenRequestUrl, time] = page.url.split(",");

    let mdAtHomeServerUrl: string;
    if (!(Date.now() - Number(time) > MDConstants.mdAtHomeTokenLifespan)) {
      mdAtHomeServerUrl = host;
    } else {
      const tokenLifespan = Date.now() - (this.tokenTracker.get(tokenRequestUrl) ?? 0);
      const forceNetwork = tokenLifespan > MDConstants.mdAtHomeTokenLifespan;
      mdAtHomeServerUrl = await this.getMdAtHomeUrl(tokenRequestUrl, client, headers, forceNetwork);
    }

    return mdAtHomeServerUrl + page.imageUrl;
  }

  /** Get the MD@Home URL. */
  private async getMdAtHomeUrl(tokenRequestUrl: string, client: HttpClient, headers: Headers, forceNetwork: boolean): Promise<string> {
    if (forceNetwork) this.tokenTracker.set(tokenRequestUrl, Date.now());
    const response = await client.get(tokenRequestUrl, headers, { ensureSuccess: false });

    // This check is for the error that causes pages to fail to load.
    // It should never be entered, but in case it is, we retry the request.
    if (response.code === 504) {
      return this.getMdAtHomeUrl(tokenRequestUrl, client, headers, true);
    }

    return parseAs<AtHomeDto>(response.text()).baseUrl;
  }

  mdAtHomeRefresh(tokenRequestUrl: string) {
    this.tokenTracker.set(tokenRequestUrl, Date.now());
  }

  private findTitleByLang(list: Record<string, string>[], lang: string): string | undefined {
    const found = list.find((it) => it[lang] != null);
    if (!found) return undefined;
    const values = Object.values(found);
    return values.length === 1 ? values[0] : undefined;
  }

  /** Create a [SManga] from the JSON element with only basic attributes filled. */
  createBasicManga(mangaDataDto: MangaDataDto, coverFileName: string | null | undefined, coverSuffix: string | null, lang: string, preferExtensionLangTitle: boolean): SManga {
    const manga = SManga.create();
    manga.url = `/manga/${mangaDataDto.id}`;

    const attributes = mangaDataDto.attributes!;
    const titleMap = attributes.title;
    let title: string | undefined = titleMap[lang];
    if (title == null) {
      const mainTitle = Object.values(titleMap)[0];
      const langTitle = this.findTitleByLang(attributes.altTitles, lang);
      const enTitle = this.findTitleByLang(attributes.altTitles, "en");
      title = (preferExtensionLangTitle ? [langTitle, mainTitle, enTitle] : [mainTitle, langTitle, enTitle]).find((it) => it != null);
    }
    manga.title = title != null ? this.removeEntities(title) : "";

    if (coverFileName != null) {
      manga.thumbnail_url = coverSuffix
        ? `${MDConstants.CDN_URL}/covers/${mangaDataDto.id}/${coverFileName}${coverSuffix}`
        : `${MDConstants.CDN_URL}/covers/${mangaDataDto.id}/${coverFileName}`;
    }
    return manga;
  }

  /** Create an [SManga] from the JSON element with all attributes filled. */
  createManga(
    mangaDataDto: MangaDataDto,
    chapters: Record<string, AggregateVolume>,
    firstVolumeCover: string | null | undefined,
    lang: string,
    coverSuffix: string | null,
    altTitlesInDesc: boolean,
    preferExtensionLangTitle: boolean,
    finalChapterInDesc: boolean,
  ): SManga {
    const attr = mangaDataDto.attributes!;
    const intl = this.intl;

    // Things that will go with the genre tags but aren't actually genre
    const nonGenres: string[] = [];
    if (attr.publicationDemographic != null) nonGenres.push(intl.get(`publication_demographic_${attr.publicationDemographic.toLowerCase()}`));
    if (attr.contentRating != null && attr.contentRating !== ContentRatingDto.SAFE) {
      nonGenres.push(intl.format("content_rating_genre", intl.get(`content_rating_${attr.contentRating.toLowerCase()}`)));
    }
    if (attr.originalLanguage != null) {
      const name = displayName(attr.originalLanguage, lang);
      nonGenres.push(name.charAt(0).toLocaleUpperCase(lang) + name.slice(1));
    }

    const authors = [...new Set(ofType<AuthorArtistAttributesDto>(mangaDataDto.relationships, MDConstants.AUTHOR).map((it) => it.attributes?.name).filter((it) => it != null))];
    const artists = [...new Set(ofType<AuthorArtistAttributesDto>(mangaDataDto.relationships, MDConstants.ARTIST).map((it) => it.attributes?.name).filter((it) => it != null))];

    const coverFileName = firstVolumeCover ?? ofType<CoverArtAttributesDto>(mangaDataDto.relationships, MDConstants.COVER_ART)[0]?.attributes?.fileName;

    const tags = new Map(this.mdFilters.getTags(intl).map((it) => [it.id, it.name]));

    const genresMap = new Map<string, string[]>();
    for (const tagDto of attr.tags) {
      const group = tagDto.attributes!.group;
      const name = tags.get(tagDto.id);
      const list = genresMap.get(group) ?? [];
      if (name != null) list.push(name);
      genresMap.set(group, list);
    }
    for (const [k, v] of genresMap) genresMap.set(k, v.sort((a, b) => intl.collator.compare(a, b)));

    const genreList = [...MDConstants.TAG_GROUPS_ORDER.flatMap((it) => genresMap.get(it) ?? []), ...nonGenres];

    // Build description
    const desc: string[] = [];

    const description = attr.description[lang] ?? attr.description["en"];
    if (description != null) desc.push(this.removeEntitiesAndMarkdown(description));

    if (altTitlesInDesc) {
      const romanizedOriginalLang = (attr.originalLanguage != null ? MDConstants.romanizedLangCodes[attr.originalLanguage] : undefined) ?? "";
      const altTitles = attr.altTitles
        .filter((it) => lang in it || romanizedOriginalLang in it)
        .map((it) => {
          const values = Object.values(it);
          return values.length === 1 ? values[0] : null;
        })
        .filter((it): it is string => it != null && it !== "");

      if (altTitles.length) {
        const altTitlesDesc = `${intl.get("alternative_titles")}\n` + altTitles.map((it) => `• ${it}`).join("\n");
        desc.push(this.removeEntities(altTitlesDesc));
      }
    }

    if (finalChapterInDesc) {
      const finalChapter: string[] = [];
      if (attr.lastVolume) finalChapter.push(`Vol.${attr.lastVolume}`);
      if (attr.lastChapter) finalChapter.push(`Ch.${attr.lastChapter}`);

      if (finalChapter.length) {
        const finalChapterDesc = `${intl.get("final_chapter")}\n` + finalChapter.join(" ");
        desc.push(this.removeEntities(finalChapterDesc));
      }
    }

    const manga = this.createBasicManga(mangaDataDto, coverFileName, coverSuffix, lang, preferExtensionLangTitle);
    manga.description = desc.join("\n\n");
    manga.author = authors.join(", ");
    manga.artist = artists.join(", ");
    manga.status = this.getPublicationStatus(attr, chapters);
    manga.genre = genreList.filter((it) => it !== "").join(", ");
    return manga;
  }

  /** Create the [SChapter] from the JSON element. */
  createChapter(chapterDataDto: ChapterDataDto): SChapter {
    const attr = chapterDataDto.attributes!;
    const intl = this.intl;

    let groups = ofType<ScanlationGroupAttributes>(chapterDataDto.relationships, MDConstants.SCANLATION_GROUP)
      .filter((it) => it.id !== MDConstants.LEGACY_NO_GROUP_ID) // 'no group' left over from MDv3
      .map((it) => it.attributes?.name)
      .filter((it) => it != null)
      .join(" & ");
    if (!groups) {
      // Fallback to uploader name if no group is set.
      const users = ofType<UserAttributes>(chapterDataDto.relationships, MDConstants.USER)
        .map((it) => it.attributes?.username)
        .filter((it) => it != null);
      groups = users.length ? intl.format("uploaded_by", users.join(" & ")) : "";
    }
    if (!groups) groups = intl.get("no_group"); // "No Group" as final resort

    // Build chapter name
    const chapterName: string[] = [];
    if (attr.volume) chapterName.push(`Vol.${attr.volume}`);
    if (attr.chapter) chapterName.push(`Ch.${attr.chapter}`);
    if (attr.title) {
      if (chapterName.length) chapterName.push("-");
      chapterName.push(attr.title);
    }

    // if volume, chapter and title is empty its a oneshot
    if (!chapterName.length) chapterName.push("Oneshot");

    // In future calculate [END] if non mvp api doesn't provide it

    const unavailablePrefix = attr.isUnavailable === true ? intl.get("chapter_unavailable_prefix") + " - " : "";

    const chapter = SChapter.create();
    chapter.url = `/chapter/${chapterDataDto.id}`;
    chapter.name = this.removeEntities(chapterName.join(" "));
    chapter.date_upload = tryParseInstant(attr.publishAt);
    chapter.scanlator = unavailablePrefix + groups;
    return chapter;
  }

  titleToSlug(title: string) {
    return title
      .trim()
      .toLowerCase()
      .replace(titleSpecialCharactersRegex, "-")
      .replace(trailingHyphenRegex, "")
      .split("-")
      .reduce((accumulator, element) => {
        const currentSlug = `${accumulator}-${element}`;
        return currentSlug.length > 100 ? accumulator : currentSlug;
      });
  }

  // setupEditTextUuidValidator is an Android EditText watcher; the app's settings form has no hook for it (see
  // sanitizeExistingUuidPrefs for the stored values).
}
