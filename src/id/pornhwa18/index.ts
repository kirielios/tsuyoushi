// Port of keiyoushi/extensions-source src/id/pornhwa18/Pornhwa18.kt
import { GET, type Request } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madaralegacy/index.ts";

export default class Pornhwa18 extends Madara {
  protected override filterNonMangaItems = false;
  protected override popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/series/page/${page}/?m_orderby=views`, this.headers);
  }
  protected override latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/series/page/${page}/?m_orderby=latest`, this.headers);
  }
}
