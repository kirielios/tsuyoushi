// Port of keiyoushi/extensions-source src/id/ngamenkomik/NgamenKomik.kt
import type { ClientBuilder } from "../../../sdk/index.ts";
import { Genre, Status, Type, ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class NgamenKomik extends ZeistManga {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  // ============================== Filters ===============================
  protected override hasFilters = true;
  protected override hasLanguageFilter = false;

  protected override getTypeList(): Type[] {
    return [new Type("Semua", ""), new Type("Manhua", "Manhua"), new Type("Manhwa", "Manhwa")];
  }

  protected override getStatusList(): Status[] {
    return [new Status("Semua", ""), new Status("Ongoing", "Ongoing"), new Status("Completed", "Completed")];
  }

  protected override getGenreList(): Genre[] {
    return [
      "Action", "Adventure", "Comedy", "Drama",
      "Ecchi", "Fantasy", "Harem", "Horror",
      "Isekai", "Magic", "Martial Arts", "Mystery",
      "Reincarnation", "Romance", "School Life", "Shounen",
      "Slice of Life", "Supernatural", "Thriller",
    ].map((it) => new Genre(it, it));
  }
}
