// Port of keiyoushi/extensions-source src/id/mangakuri/Mangakuri.kt
import { LoneSeal, UrlLayout, type ChapterPagesResponseDto } from "../../../themes/loneseal/index.ts";

export default class Mangakuri extends LoneSeal {
  protected override urlLayout = UrlLayout.LEGACY_COMIC;
  protected override get overloadedGenres(): Set<string> {
    return new Set([...super.overloadedGenres, "yaoi"]);
  }

  // Upstream reads the login token from the WebView's localStorage (getLocalStorage(baseUrl, "token")). There is no
  // WebView here, so no token is ever found and login-only chapters stay unreadable.
  private bearerToken: string | null = null;

  protected override async configureChapterHeaders(headers: Headers): Promise<Headers> {
    if (this.bearerToken != null) headers.set("Authorization", `Bearer ${this.bearerToken}`);
    return headers;
  }

  protected override onEmptyPages(dto: ChapterPagesResponseDto): void {
    if (dto.chapter.password_required) throw new Error("Password required");
    if (dto.chapter.login_required === true) {
      this.bearerToken = null;
      throw new Error("Login in WebView and retry");
    }
  }
}
