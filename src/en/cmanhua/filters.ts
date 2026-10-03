// Port of keiyoushi/extensions-source src/en/cmanhua/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly options: [string, string][],
  ) {
    super(
      displayName,
      options.map((it) => it[0]),
    );
  }
  toUriPart(): string {
    return this.options[this.state][1];
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export const SORT_OPTIONS: [string, string][] = [
  ["Update time", "0"],
  ["New Manhua", "1"],
  ["Top Views", "2"],
  ["Top Views Month", "3"],
  ["Top Views Week", "4"],
  ["Top Follow", "5"],
  ["Top Comment", "6"],
  ["Number Chapters", "7"],
];

export const STATUS_OPTIONS: [string, string][] = [
  ["All", "-1"],
  ["Ongoing", "0"],
  ["Completed", "1"],
];

export const CHAPTER_OPTIONS: [string, string][] = [
  [">= 0 Chapter", "0"],
  [">= 100 Chapter", "100"],
  [">= 200 Chapter", "200"],
  [">= 300 Chapter", "300"],
  [">= 400 Chapter", "400"],
  [">= 500 Chapter", "500"],
];

export const GENDER_OPTIONS: [string, string][] = [
  ["All", "-1"],
  ["Male", "0"],
  ["Female", "1"],
];

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", STATUS_OPTIONS);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Order by", SORT_OPTIONS);
  }
}

export class ChapterCountFilter extends UriPartFilter {
  constructor() {
    super("Min chapters", CHAPTER_OPTIONS);
  }
}

export class GenderFilter extends UriPartFilter {
  constructor() {
    super("For", GENDER_OPTIONS);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export const GENRES: Genre[] = [
  new Genre("ACTION", "68fed7700631ac1780da60fb"),
  new Genre("ADAPTATION", "691b1a3d0631ac14cc79fc07"),
  new Genre("ADVENTURE", "691c501b0631ac20d8f052ce"),
  new Genre("Ability", "68fc7e9e0631ac1688c92be2"),
  new Genre("Action", "66d02d130631ac1f64248dbb"),
  new Genre("Adaptation", "66d055410631ac1f642a5c96"),
  new Genre("Adenture", "691ffd2a0631ac2d8c9d058e"),
  new Genre("Adult", "66d3439e0631ba299492391b"),
  new Genre("Adventure", "66d02d130631ac1f64248dbc"),
  new Genre("Aliens", "6926f15f0631ac0d7821ef71"),
  new Genre("Animals", "66f115650631ac20947585fc"),
  new Genre("Apocalypse", "66f10c130631ac209474b09b"),
  new Genre("Beasts", "68e5cbc90631ac1e7c7f462f"),
  new Genre("Blood", "68dcee320631ac17a8b9b3e4"),
  new Genre("Bloody", "6926f15f0631ac0d7821ef70"),
  new Genre("COMEDY", "691c501b0631ac20d8f052cd"),
  new Genre("Cheat", "68dcecad0631ac17a8b8c98b"),
  new Genre("Cheat Systems", "68fc3c870631ac347882afd5"),
  new Genre("Childhood Friends", "671afb540631ac0f6c8610de"),
  new Genre("Chinese", "670d0c0c0631ad2840edea67"),
  new Genre("College life", "6713c7fc0631ac1cf8c79d6f"),
  new Genre("Comedy", "66d02d130631ac1f64248dbd"),
  new Genre("Comic", "66e17c8f0631ac324478c238"),
  new Genre("Contest winning", "6926f15f0631ac0d7821ef72"),
  new Genre("Cooking", "66d2c2270631ac299467be19"),
  new Genre("Crime", "66d1e88c0631ac06a8bc9841"),
  new Genre("Crossdressin", "66d786730631ac0df8365ac5"),
  new Genre("Cultivation", "68e8c65b0631ac1560d49631"),
  new Genre("DRAMA", "68fed7700631ac1780da60fd"),
  new Genre("Delinquents", "66f597aa0631b00bd4815722"),
  new Genre("Demons", "68e4bce40631ac10f4d353f6"),
  new Genre("Dragon", "68e5d19c0631ac1e7c80d47a"),
  new Genre("Drama", "66d01d560631ac1f642312ef"),
  new Genre("Drama Sad Supernatural", "691be5dd0631ac20d8eec37b"),
  new Genre("Dungeons", "672a9f720631ac2d644b0480"),
  new Genre("Ecchi", "66d347ad0631bd29944d4b07"),
  new Genre("Evolution", "691fe4200631ac2d8c9c67eb"),
  new Genre("FANTASY", "68fed7700631ac1780da60fe"),
  new Genre("FULL COLOR", "68fed7700631ac1780da60ff"),
  new Genre("Fantasy", "66d01d570631ac1f642312f0"),
  new Genre("Fantasy Harem", "691d8c080631ac031ce78715"),
  new Genre("Fight", "68e61ac10631ac22a4390e84"),
  new Genre("Fighting", "68dcea240631ac17a8b798c8"),
  new Genre("Full Color", "66d2dba10631ac29946b9573"),
  new Genre("Game", "66f0f9910631ac2094730f65"),
  new Genre("Gender Bender", "66d300bf0631ac2994726b5e"),
  new Genre("Ghost", "68e620e70631ac22a43e49c6"),
  new Genre("Ghosts", "690df10e0631ac2af4ce1cb7"),
  new Genre("Girl Power", "691d6e730631ac031ce6af9c"),
  new Genre("Girls", "694208ef0631ac28ac180aec"),
  new Genre("Gore", "66f0cfe90631ac20946f4ed9"),
  new Genre("HAREM", "68f313eb0631ac1f5cfe3161"),
  new Genre("HISTORICAL", "68f313eb0631ac1f5cfe3160"),
  new Genre("Harem", "66d055410631ac1f642a5c97"),
  new Genre("Historical", "66d01d570631ac1f642312f1"),
  new Genre("Horror", "66d352c70631be2994fc6b5d"),
  new Genre("Hunters", "692eafb00631ac19a045d178"),
  new Genre("ISEKAI", "69115ee10631ac1de054fcc2"),
  new Genre("Isekai", "66d01d570631ac1f642312f2"),
  new Genre("Josei", "66d1cae50631ac06a8b89af7"),
  new Genre("Josei(W)", "690d7ace0631ac2af4c62300"),
  new Genre("Kids", "66e171f00631ac3244789626"),
  new Genre("LONG STRIP", "68fed7700631ac1780da60fc"),
  new Genre("Ladies", "68d6531c0631ac69e0c549b1"),
  new Genre("Liexing", "66d1b5d70631ac06a8b48581"),
  new Genre("Live action", "68e61adf0631ac22a4391b25"),
  new Genre("Loli", "66e8743a0631ac3340b168f5"),
  new Genre("Long Strip", "68fc3fa10631ac347883799b"),
  new Genre("MAGIC", "691b1a3d0631ac14cc79fc04"),
  new Genre("MARTIAL ARTS", "68f1ef020631ac2670dd00f2"),
  new Genre("MONSTERS", "68f1ef020631ac2670dd00f0"),
  new Genre("Magic", "66d16fb00631ac1f644c8c1e"),
  new Genre("Magical", "66d40c370631be29940b6fc6"),
  new Genre("Magical Girls", "692958510631ac1b744407e3"),
  new Genre("Manga", "66dfabe60631ac146491b4dd"),
  new Genre("Mangatoon", "66f0f6d90631ac209472c08d"),
  new Genre("Manhua", "66d089940631ac1f642f2cd5"),
  new Genre("Manhuaga Scans", "6945a1fc0631ac32244f9295"),
  new Genre("Manhwa", "66d02d130631ac1f64248dbe"),
  new Genre("Manhwa Hot", "67197bb10631ac14d04e2423"),
  new Genre("Martial Arts", "66d06cc70631ac1f642c3e9f"),
  new Genre("Martial arts", "690d89b30631ac2af4c713a4"),
  new Genre("Mature", "66d3439e0631ba299492391c"),
  new Genre("Mecha", "66d83fc20631ac0bfc9caeda"),
  new Genre("Medical", "66d45ce40631ac2b18b73976"),
  new Genre("Medicaldrama", "66f0f8670631ac209472dad7"),
  new Genre("Military", "66f597aa0631b00bd4815723"),
  new Genre("Moder", "66d343700631ba299492365e"),
  new Genre("Monster", "68dde6bb0631ac28c0aa6d1d"),
  new Genre("Monster Girls", "66f550680631b00bd477489b"),
  new Genre("Monsters", "66d11bea0631ac1f643e1578"),
  new Genre("Murim", "66dfd50d0631ac1464927f09"),
  new Genre("Music", "66d786730631ac0df8365ac7"),
  new Genre("Mystery", "66d1e4390631ac06a8bbfcd9"),
  new Genre("Ngon Tinh", "6710c2c30631ac2b04a5fc1f"),
  new Genre("Non-human", "692968910631ac1b7444383e"),
  new Genre("OFFICIAL COLORED", "69115ee10631ac1de054fcc1"),
  new Genre("OP MC", "692818140631ac1b743e4050"),
  new Genre("OP-MC", "68dcecad0631ac17a8b8c98d"),
  new Genre("Office Workers", "66e20c3f0631ac0cac257ad2"),
  new Genre("Official Colored", "68fedf8e0631ac1780db980d"),
  new Genre("Official colored", "6720683d0631ac1ac07fd3ec"),
  new Genre("One shot", "66d2a0140631ac2994624947"),
  new Genre("Op-Mc", "68dcee320631ac17a8b9b3e5"),
  new Genre("Others", "68d641350631ac69e0b98d6e"),
  new Genre("Overpowered", "68e4e24f0631ac10f4db444b"),
  new Genre("Philosophical", "66d1e4390631ac06a8bbfcda"),
  new Genre("Ping Ping Jun", "66d524a90631ac2b18c655fd"),
  new Genre("Police", "66d786730631ac0df8365ac8"),
  new Genre("Post Apocalyptic", "691ed70c0631ac2d8c9696d6"),
  new Genre("Post apocalyptic", "66f707ac0631ac12247b3a79"),
  new Genre("Post-Apocalyptic", "68fc84330631ac1688c97ff4"),
  new Genre("Psychological", "66d0ab580631ac1f6432aeaa"),
  new Genre("REINCARNATION", "68de2e5b0631ac28c0bcc010"),
  new Genre("ROMANCE", "68e5cbe80631ac1e7c7f4fa9"),
  new Genre("Rebirth", "6729e44a0631ac2d643df17b"),
  new Genre("Regression", "690dfbf50631ac2af4cedd06"),
  new Genre("Reincarnation", "66d139250631ac1f6440d6cc"),
  new Genre("Revenge", "671372470631ac1cf8c17fab"),
  new Genre("Reverse", "66d1b5d70631ac06a8b48582"),
  new Genre("Reverse Harem", "690dae0e0631ac2af4c9644a"),
  new Genre("Reverse harem", "66d1b5d70631ac06a8b48583"),
  new Genre("Romance", "66d01d570631ac1f642312f3"),
  new Genre("Royal family", "66d44d700631ac2b18b628a5"),
  new Genre("Royalty", "6926a7db0631ac0d781f1731"),
  new Genre("Ruthless Protagonist", "68dcee320631ac17a8b9b3e6"),
  new Genre("SCHOOL LIFE", "691b1a3d0631ac14cc79fc05"),
  new Genre("SEXUAL VIOLENCE", "66f0fbca0631ac2094738844"),
  new Genre("SUGGESTIVE", "691b1a3d0631ac14cc79fc03"),
  new Genre("SUPERHERO", "68de2e5b0631ac28c0bcc014"),
  new Genre("SUPERNATURAL", "69115ee10631ac1de054fcc3"),
  new Genre("School Life", "66d07c3a0631ac1f642d7c51"),
  new Genre("School life", "6900066a0631ac1780e64970"),
  new Genre("Sci-Fi", "691ed70c0631ac2d8c9696d7"),
  new Genre("Sci-fi", "68e4d2980631ac10f4d71039"),
  new Genre("Seinen", "66d1c77d0631ac06a8b7feb4"),
  new Genre("Seinen(M)", "6926a79c0631ac0d781f1407"),
  new Genre("Sexual Violence", "68fedf8e0631ac1780db980e"),
  new Genre("Shoujo", "66d01d570631ac1f642312f4"),
  new Genre("Shoujo Ai", "66d339170631ad29947c49ff"),
  new Genre("Shoujo(G)", "690ddb800631ac2af4cccb66"),
  new Genre("Shounen", "66d045090631ac1f64279346"),
  new Genre("Shounen Ai", "66d3100a0631ac299475db10"),
  new Genre("Shounen ai", "690e128d0631ac2af4cff7b5"),
  new Genre("Shounen(B)", "690e128d0631ac2af4cff7b4"),
  new Genre("Showbiz", "66fb3ed30631ac0f549f7dbf"),
  new Genre("Si-fi", "670ab1fc0631ac3ec007f82b"),
  new Genre("Slice of Life", "66d2afd30631ac2994648de9"),
  new Genre("Slice of life", "68e5e6540631ac1e7c8cd621"),
  new Genre("Smart MC", "68dcee320631ac17a8b9b3e7"),
  new Genre("Smut", "66d343830631ba2994923827"),
  new Genre("Soft Yaoi", "671b34c50631ac0f6c8a80e0"),
  new Genre("Sports", "66d6a4e70631ac29b0ac9400"),
  new Genre("Super Power", "68ddfcb90631ac28c0b01c88"),
  new Genre("Super power", "691d83ca0631ac031ce741b3"),
  new Genre("Superhero", "66d1e4390631ac06a8bbfcdb"),
  new Genre("Supernatural", "66d045090631ac1f64279347"),
  new Genre("Survival", "66d56e370631ac2b18cd6935"),
  new Genre("System", "66f0f9910631ac2094730f66"),
  new Genre("THRILLER", "68e5dc4e0631ac1e7c880ef6"),
  new Genre("TIME TRAVEL", "6920a63b0631ac1e24c50cf8"),
  new Genre("Tamer", "68dde6bb0631ac28c0aa6d1e"),
  new Genre("Terror", "68e49b860631ac10f4cc2618"),
  new Genre("Thriller", "66d315d80631ac299476fc45"),
  new Genre("Time Travel", "66d11bea0631ac1f643e157a"),
  new Genre("Time travel", "691d9f2e0631ac031ce80a7c"),
  new Genre("Tragedy", "66d0d5ac0631ac1f64377cdc"),
  new Genre("Transmigration", "66e171f00631ac3244789627"),
  new Genre("Vampire", "66d3e7d60631be2994083f15"),
  new Genre("Video Games", "66f115650631ac20947585fb"),
  new Genre("Villainess", "66d2c2270631ac299467be1a"),
  new Genre("Violence", "66e168f00631ac3244786bc7"),
  new Genre("WEB COMIC", "691b1a3d0631ac14cc79fc06"),
  new Genre("WUXIA", "68de02e90631ac28c0b1fcc2"),
  new Genre("Weak-to-Strong", "68e4e60f0631ac10f4dc6a85"),
  new Genre("Web Comic", "68de2c230631ac28c0bbcd4f"),
  new Genre("Webtoon", "66d2d39f0631ac29946a43e3"),
  new Genre("Webtoons", "68e5fb170631ac1e7c9e1496"),
  new Genre("Wuxia", "66f0efa10631ac2094723e37"),
  new Genre("Xianxia", "68de070e0631ac28c0b33e52"),
  new Genre("Xuanhuan", "68e4d2980631ac10f4d7103a"),
  new Genre("Yaoi", "68da064c0631ac14d06a8648"),
  new Genre("Yaoi(BL)", "692a44ad0631ac31bc8fa9eb"),
  new Genre("Yuri", "66ea188e0631ac2264610151"),
  new Genre("Yuri(GL)", "69272aa90631ac0d7822957d"),
  new Genre("Zombie", "691ec1920631ac2d8c96147a"),
  new Genre("Zombies", "66f707ac0631ac12247b3a7a"),
  new Genre("action", "691d8d4b0631ac031ce793b5"),
  new Genre("adventure", "691db3ab0631ac031ce8cbe7"),
  new Genre("apocalypse", "691f96040631ac2d8c99f6ab"),
  new Genre("comedy", "691db1810631ac031ce8c489"),
  new Genre("cooking", "691ed5790631ac2d8c968f76"),
  new Genre("crime", "691ebd200631ac2d8c95e313"),
  new Genre("ecchi", "68fc7cef0631ac1688c915ce"),
  new Genre("fantasy", "691d9eec0631ac031ce8096d"),
  new Genre("future era", "68dcea240631ac17a8b798c9"),
  new Genre("gender bender", "68fc38b40631ac347881c145"),
  new Genre("goddess", "68e624420631ac22a4414103"),
  new Genre("harem", "691d8d4b0631ac031ce793b4"),
  new Genre("horror", "691ebd200631ac2d8c95e312"),
  new Genre("isekai", "691d8d4b0631ac031ce793b3"),
  new Genre("ladies", "691dbbab0631ac031ce906c7"),
  new Genre("mangatoon", "692811c20631ac1b743dfe17"),
  new Genre("manhua", "68fc38b60631ac347881c148"),
  new Genre("manhuaus", "691d8df40631ac031ce796e0"),
  new Genre("manhwa", "692d12910631ac1404c26f9b"),
  new Genre("martial arts", "691d8d4b0631ac031ce793b6"),
  new Genre("mature", "6928570b0631ac1b74404879"),
  new Genre("medical", "691ed02c0631ac2d8c967c8a"),
  new Genre("romance", "691db1810631ac031ce8c488"),
  new Genre("school life", "691db1340631ac031ce8c26b"),
  new Genre("sci-fi", "691da4020631ac031ce82f49"),
  new Genre("thriller", "691ec6700631ac2d8c963943"),
];
