// Port of keiyoushi/extensions-source src/en/readonepiecemangaonline/ReadOnePieceMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadOnePieceMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["One Piece", `${this.baseUrl}/manga/one-piece/`],
    ["Colored", `${this.baseUrl}/manga/one-piece-digital-colored-comics/`],
    ["Soma x Sanji", `${this.baseUrl}/manga/shokugeki-no-sanji-one-shot/`],
    ["OP x Toriko", `${this.baseUrl}/manga/one-piece-x-toriko/`],
    ["Party", `${this.baseUrl}/manga/one-piece-party/`],
    ["DB x OP", `${this.baseUrl}/manga/dragon-ball-x-one-piece/`],
    ["Wanted!", `${this.baseUrl}/manga/wanted-one-piece/`],
    ["Ace's Story", `${this.baseUrl}/manga/one-piece-ace-s-story/`],
    ["Omake", `${this.baseUrl}/manga/one-piece-omake/`],
    ["Vivre Card", `${this.baseUrl}/manga/vivre-card-databook/`],
    ["Pirate Recipes", `${this.baseUrl}/manga/one-piece-pirate-recipes/`],
    ["Databook", `${this.baseUrl}/manga/one-piece-databook/`],
    ["Ace's Story Manga", `${this.baseUrl}/manga/one-piece-ace-story-manga/`],
    ["OP Academy", `${this.baseUrl}/manga/one-piece-academy/`],
    ["MONSTERS", `${this.baseUrl}/manga/monsters/`],
    ["Zoro Novel", `${this.baseUrl}/manga/one-piece-novel-zoro/`],
    ["OP in Love", `${this.baseUrl}/manga/one-piece-in-love/`],
    ["Heroines", `${this.baseUrl}/manga/one-piece-novel-heroines/`],
  ];
}
