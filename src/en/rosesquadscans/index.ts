// Port of keiyoushi/extensions-source src/en/rosesquadscans/RoseSquadScans.kt
import { ClientBuilder, DateTimeFormatter, Locale, type Chain, type Response } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class RoseSquadScans extends Madara {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("MM.dd.yyyy", Locale.US);
  protected override chapterMode = ChapterMode.MangaAjax;

  override get supportsFilterFetching() {
    return false;
  }

  protected override configureClient(b: ClientBuilder) {
    b.addChainInterceptor((chain) => this.authWarningIntercept(chain));
    b.rateLimit(1, 2000);
    return b;
  }

  private async authWarningIntercept(chain: Chain): Promise<Response> {
    const response = await chain.proceed(chain.request());

    if (response.url.includes("wp-login.php")) {
      throw new Error("It's necessary to login via WebView to access this source.");
    }

    return response;
  }
}
