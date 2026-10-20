// Port of yuzono/anime-extensions src/all/missav/MissAvDtoModels.kt
import { MangasPage, SAnime } from "../../../sdk/index.ts";
import { RESULT_COUNT } from "./api.ts";

export interface RecommendationsResponse {
  recommId: string;
  recomms: Recommendation[];
  numberNextRecommsCalls: number;
}

interface Recommendation {
  id: string;
  values: { dm?: number | null; title_en?: string | null };
}

const STRIP_SUB_REGEX = /-uncensored-leak|-chinese-subtitle|-english-subtitle/g;

export const toAnimePage = (r: RecommendationsResponse): MangasPage =>
  new MangasPage(
    r.recomms.map(toSAnime).filter((it): it is SAnime => it != null),
    r.recomms.length >= RESULT_COUNT,
  );

function toSAnime({ id, values: videoInfo }: Recommendation): SAnime | null {
  if (videoInfo.dm == null || videoInfo.title_en == null) return null;
  const stripID = id.toLowerCase().replace(STRIP_SUB_REGEX, "");
  const anime = SAnime.create();
  anime.url = videoInfo.dm === 0 ? `/en/${id}` : `/dm${videoInfo.dm}/en/${id}`;
  anime.title = `${stripID.toUpperCase()} ${videoInfo.title_en}`;
  anime.thumbnail_url = `https://fourhoi.com/${stripID}/cover-t.jpg`;
  return anime;
}
