// Port of yuzono/anime-extensions src/en/anichi/Anichi.kt
// ponytail: the related-anime overrides (watch order, extractAnimePath, extractRelatedThumbnail) are left out with the theme's related list.
import { SAnime, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";
import { AnikotoTheme, SCORE_POS_BOTTOM, SCORE_POS_TOP, studioLine } from "../../../themes/anikototheme/index.ts";

export default class Anichi extends AnikotoTheme {
  protected hosterNames = ["HD-1", "Vidstream-2", "VidCloud-1", "Kiwi-Stream", "VidPlay-1"]; // seed/fallback only
  protected override hasSourceFilter = true;
  protected override hasEpisodeFilter = true;

  // ======================= Selector Overrides ===========================
  protected override listingThumbnailSelector = "div.ani.poster img";
  protected override synopsisContentSelector = ".series-blurb__full, .series-blurb__short";
  protected override detailThumbnailSelector = ".series-intro__poster img";

  // ======================= Anime Details Override =======================
  protected override async parseAnimeDetails(document: Document): Promise<SAnime> {
    const newDocument = await this.resolveSearchAnime(document);
    const titleElement = newDocument.selectFirst("h1.series-title");
    const animeId = newDocument.selectFirst("[data-id]")?.attr("data-id");
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(newDocument.location());
    if (animeId) anime.url += `#${animeId}`;
    anime.title = this.getTitle(titleElement ?? newDocument.selectFirst("h1")!);
    anime.genre = newDocument.select(".series-genres .series-genre").eachText().join(", ");
    anime.author = newDocument.select(".series-fact:contains(Studios) .series-fact__value a").eachText().join(", ");
    anime.status = this.parseStatus(newDocument.select(".series-fact:contains(Status) .series-fact__value").text());
    anime.description = this.buildDescription(newDocument, titleElement);
    const img = newDocument.selectFirst(this.detailThumbnailSelector);
    const url = img ? img.attr("data-src") || img.attr("src") : "";
    if (url) anime.thumbnail_url = url;
    return anime;
  }

  protected override buildDescription(document: Document, titleElement: Element | null): string {
    const out: string[] = [];
    const enTitle = titleElement?.text() || null;
    const jpTitle = titleElement?.attr("data-jp").trim() || null;
    const fancyScore = this.getFancyScore(document.select(".series-intro__poster .series-score b").text());
    if (this.scorePosition === SCORE_POS_TOP && fancyScore) out.push(fancyScore);

    const synopsis = document.selectFirst(".series-blurb__full") ?? document.selectFirst(".series-blurb__short");
    if (synopsis) out.push(synopsis.text());

    const meta = document.select(".series-facts__grid .series-fact").flatMap((div) => {
      const label = (div.selectFirst(".series-fact__label")?.text() ?? "").replace(/:$/, "");
      const value = div.selectFirst(".series-fact__value")?.text() ?? "";
      return label && value && !this.metaExclusionLabels.includes(label) ? [`${label}: ${value}`] : [];
    });
    if (meta.length) out.push(meta.join(" | "));

    const sp = studioLine(
      document.select(".series-fact:contains(Studios) .series-fact__value a").eachText().join(", "),
      document.select(".series-fact:contains(Producers) .series-fact__value a").eachText().join(", "),
    );
    if (sp) out.push(sp);

    const altNames: string[] = [];
    const other = this.useEnglish() ? jpTitle : enTitle;
    if (other) altNames.push(other);
    const nativeTitle = document.selectFirst(".series-native")?.text();
    if (nativeTitle != null && nativeTitle !== jpTitle && nativeTitle !== enTitle) altNames.push(nativeTitle);
    if (altNames.length) out.push(`**Other name(s):** ${altNames.join(", ")}`);

    if (this.scorePosition === SCORE_POS_BOTTOM && fancyScore) out.push(fancyScore);
    return out.join("\n\n").trim();
  }

  protected override parseStatus(statusString: string): number {
    switch (statusString.toLowerCase()) {
      case "ongoing":
      case "currently airing":
        return SAnime.ONGOING;
      case "finished airing":
      case "completed":
        return SAnime.COMPLETED;
      default:
        return SAnime.UNKNOWN;
    }
  }
}
