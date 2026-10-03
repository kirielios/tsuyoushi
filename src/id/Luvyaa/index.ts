// Port of keiyoushi/extensions-source src/id/Luvyaa/Luvyaa.kt
import { SwitchPreferenceCompat, toHttpUrl, type Document, type HttpUrlBuilder, type PreferenceScreen, type SChapter } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

const PREF_HIDE_LOCKED = "pref_hide_locked_chapters";

const LOCKED_URLS_REGEX = /lockedUrls\s*=\s*\[(.*?)]/;

const removeSurrounding = (s: string, d: string) => (s.length >= 2 * d.length && s.startsWith(d) && s.endsWith(d) ? s.slice(d.length, -d.length) : s);

export default class Luvyaa extends MangaThemesia {
  override datePattern = "dd/MM/yyyy";

  override searchMangaUrl(page: number, query: string): HttpUrlBuilder {
    if (query) {
      const b = toHttpUrl(this.baseUrl).newBuilder();
      b.addQueryParameter("s", query);
      b.addQueryParameter("page", String(page));
      return b;
    }
    return super.searchMangaUrl(page, query);
  }

  override chapterListParse(document: Document): SChapter[] {
    const lockedUrls =
      LOCKED_URLS_REGEX.exec(document.outerHtml())?.[1]
        ?.split(",")
        .map((it) => removeSurrounding(removeSurrounding(it.trim(), "'"), '"').replaceAll("\\/", "/")) ?? [];

    const hideLocked = this.preferences.getBoolean(PREF_HIDE_LOCKED, false);

    return document.select(super.chapterListSelector()).flatMap((element) => {
      const chapter = super.chapterFromElement(element);
      const isLocked = lockedUrls.some((it) => it.endsWith(chapter.url));

      if (hideLocked && isLocked) return [];

      if (isLocked) chapter.name = `🔒 ${chapter.name}`;
      return [chapter];
    });
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = PREF_HIDE_LOCKED;
    pref.title = "Sembunyikan chapter terkunci";
    pref.summary = "Sembunyikan chapter yang memerlukan membership (VIP)";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}
