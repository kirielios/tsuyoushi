// Port of yuzono/anime-extensions src/en/anikoto/Anikoto.kt
import { AnikotoTheme } from "../../../themes/anikototheme/index.ts";

export default class Anikoto extends AnikotoTheme {
  protected hosterNames = ["HD-1", "Vidstream-2", "VidCloud-1", "Kiwi-Stream", "VidPlay-1"]; // seed/fallback only
  protected override hasSourceFilter = true;
  protected override hasEpisodeFilter = true;
}
