// Port of yuzono/anime-extensions src/en/animesogo/AnimeSogo.kt
// ponytail: the related-anime selectors and extractRelatedThumbnail are left out with the theme's related list.
import { GET, toHttpUrl, type Document, type FilterList } from "../../../sdk/index.ts";
import { AnikotoTheme, AnikotoThemeFilters, type VideoData } from "../../../themes/anikototheme/index.ts";

export default class AnimeSogo extends AnikotoTheme {
  protected hosterNames = ["HD-1", "HD-2", "HD-3", "VidPlay-1", "Kiwi-Stream"];
  protected override useEpisodeTitles = false;

  // =================== Selector Overrides ==============================
  protected override metaContainerSelector = "div.bl-meta";
  protected override scoreLabelName = "Scores";
  protected override aliasContainerSelector = "div.alias";
  protected override metaExclusionLabels = ["Genres", "Status", "Studios", "Producers", "Scores"];
  protected override synopsisContentSelector = "div.synopsis > div.content";
  protected override detailThumbnailSelector = "section#w-info div.poster img";
  protected override listingThumbnailSelector = "a.poster img";

  // =================== Episode List Override ===========================
  protected override episodeListSelector() {
    return "ul.episodes > li > a";
  }

  // =================== Server Name Mapping =============================
  protected override extractBaseServerName(rawName: string): string {
    const base = super.extractBaseServerName(rawName);
    return base === "Server" ? "Kiwi-Stream" : base;
  }

  override getServerDisplayName(serverName: string): string {
    if (serverName.toLowerCase().startsWith("server")) {
      const suffix = serverName.slice("Server".length).trim();
      return "Kiwi-Stream" + (suffix ? ` ${suffix}` : "");
    }
    return serverName.replace(/[- ]+$/, "");
  }

  // =================== Video Server List Override ======================
  override parseServerListData(document: Document): VideoData[] {
    const typeElements = document.select("div.type");
    this.updateDiscoveredServers(
      typeElements.flatMap((elem) =>
        elem
          .select("a.server")
          .flatMap((it) => it.selectFirst("span")?.text().trim() || [])
          .map((it) => this.getServerDisplayName(it)),
      ),
      false,
    );

    const typeToggle = this.typeToggle;
    const hostToggle = [...this.hostToggle].map((it) => it.toLowerCase());
    return typeElements.flatMap((elem) => {
      const label = this.resolveTypeLabel(elem);
      if (!this.isTypeEnabled(label, typeToggle)) return [];
      return elem.select("a.server").flatMap((serverElem) => {
        const serverId = serverElem.attr("data-link-id");
        if (!serverId.trim()) return [];
        const rawName = serverElem.selectFirst("span")?.text().trim();
        if (rawName == null) return [];
        const serverName = this.getServerDisplayName(rawName);
        if (!hostToggle.includes(serverName.toLowerCase())) return [];
        return [{ type: label, serverId, serverName }];
      });
    });
  }

  // =================== Search Override =================================
  protected override searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const params = AnikotoThemeFilters.getSearchParameters(filters);
    const vrf = query.trim() ? this.vrfEncrypt(query) : "";
    const { addListQueryParameter: list, addQueryParameterIfNotEmpty: ifNotEmpty } = AnikotoThemeFilters;
    const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("filter").addQueryParameter("keyword", query).addQueryParameter("page", String(page)).addQueryParameter("vrf", vrf);
    list(b, "genre", params.genres);
    list(b, "season", params.seasons);
    list(b, "year", params.years);
    list(b, "term_type", params.types);
    list(b, "status", params.statuses);
    list(b, "language", params.languages);
    list(
      b,
      "rating",
      params.ratings.map((it) => it.toLowerCase().replace(/-/g, "_")),
    );
    ifNotEmpty(b, "sort", params.sort);
    return GET(b.build(), this.docHeaders);
  }
}
