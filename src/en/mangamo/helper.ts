// Port of keiyoushi/extensions-source src/en/mangamo/MangamoHelper.kt
import { SManga } from "../../../sdk/index.ts";
import { MangamoConstants } from "./constants.ts";
import type { ChapterDto, SeriesDto } from "./dto.ts";

/** java.net.URLEncoder.encode(s, "utf-8") */
const javaUrlEncode = (s: string) =>
  encodeURIComponent(s)
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");

export class MangamoHelper {
  private readonly headers: () => Headers;
  constructor(headers: () => Headers) {
    this.headers = headers;
  }

  get jsonHeaders(): Headers {
    const h = new Headers(this.headers());
    h.set("Content-Type", "application/json");
    return h;
  }

  private getCatalogUrl(series: SeriesDto): string {
    const lowercaseHyphenated = series.name_lowercase!.replaceAll(" ", "-");
    return `/catalog/${javaUrlEncode(lowercaseHyphenated)}`;
  }

  getSeriesUrl(series: SeriesDto): string {
    return `${this.getCatalogUrl(series)}?${MangamoConstants.SERIES_QUERY_PARAM}=${series.id}`;
  }

  getChapterUrl(chapter: ChapterDto): string {
    return `?${MangamoConstants.SERIES_QUERY_PARAM}=${chapter.seriesId}&${MangamoConstants.CHAPTER_QUERY_PARAM}=${chapter.id}`;
  }

  getSeriesStatus(series: SeriesDto): number {
    switch (series.releaseStatusTag) {
      case "Ongoing":
        return SManga.ONGOING;
      case "series-complete":
      case "Completed":
        return SManga.COMPLETED;
      case "Paused":
        return SManga.ON_HIATUS;
      default:
        return series.ongoing === true ? SManga.ONGOING : SManga.UNKNOWN;
    }
  }
}
