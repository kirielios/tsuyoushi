// Port of keiyoushi/extensions-source src/all/beauty3600000/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly valuePair: [string, string][],
  ) {
    super(
      displayName,
      valuePair.map((it) => it[0]),
    );
  }
  toUriPart = () => this.valuePair[this.state][1];
}

export class CategoryFilter extends UriPartFilter {
  constructor() {
    super(

      "Category",
        [
            ["Any", ""],
            ["Aidol", "6"],
            ["China", "3293"],
            ["Chinese", "5"],
            ["Cosplay", "4"],
            ["Gravure", "7"],
            ["Japan", "3291"],
            ["Korea", "2128"],
            ["Magazine", "9"],
            ["Photobook", "10"],
            ["Thailand", "8"],
            ["Uncategorized", "1"],
            ["Western", "11"],
      ],
    );
  }
}

// NOTE: Source has way more tags (~6000)
export class TagFilter extends UriPartFilter {
  constructor() {
    super(

      "Tag",
        [
            ["<Select tag>", ""],
            ["[☆JVID]", "1036"],
            ["[4K-STAR]", "1293"],
            ["[AISS爱丝钻石版]", "791"],
            ["[Akisoso秋楚楚]", "2578"],
            ["[AllGravure]", "1608"],
            ["[ArtGravia]", "2130"],
            ["[Arty亞緹]", "2207"],
            ["[Ayase_绮滨酱]", "2526"],
            ["[Azami]", "2164"],
            ["[Baijin Jiang]", "2225"],
            ["[BBUTTERMILK]", "3219"],
            ["[Bejean On Line]", "711"],
            ["[Bimilstory]", "3033"],
            ["[BLUECAKE]", "2454"],
            ["[BOMB.tv]", "102"],
            ["[BUNNY]", "4255"],
            ["[Byoru ビヨル]", "2275"],
            ["[CANDY糖果画报]", "590"],
            ["[CherryS]", "2658"],
            ["[chi.yun]", "2199"],
            ["[Chihiro]", "2645"],
            ["[CHOKmoson作品]", "729"],
            ["[Chono Black ちょうの]", "2337"],
            ["[coli厨 水無月みり]", "2237"],
            ["[Conboy]", "4649"],
            ["[Cosdoki]", "1822"],
            ["[Cosplay]", "458"],
            ["[CREAM PIE]", "4471"],
            ["[CreamSoda]", "2497"],
            ["[Crepe]", "1026"],
            ["[DCP-snaps]", "4655"],
            ["[Deepblue]", "4710"],
            ["[Deepmore Office]", "4435"],
            ["[DGC] (Desktop Gal Collection)", "172"],
            ["[Digi-Gra]", "634"],
            ["[Digital Photobook]", "1632"],
            ["[Dishwasher1910]", "2457"],
            ["[DJAWA]", "2131"],
            ["[DKGirl御女郎]", "208"],
            ["[DPB] デジタル写真集", "753"],
            ["[ED MOSAIC]", "1609"],
            ["[Eliza喵喵 Elizamiaomiao]", "2264"],
            ["[Ely]", "2316"],
            ["[EROONICHAN]", "1067"],
            ["[EroticBeauty]", "902"],
            ["[Espacia Korea]", "4881"],
            ["[Espasia Korea]", "3194"],
            ["[EternalDesire]", "904"],
            ["[Eugene Snap]", "4082"],
            ["[FAIRY CLUB 妖精社]", "3115"],
            ["[FANDING]", "3651"],
            ["[Fantasy Story]", "4381"],
            ["[FEILIN嗲囡囡]", "341"],
            ["[FemJoy]", "915"],
            ["[Fetibox]", "657"],
            ["[G44不会受伤]", "2600"],
            ["[G44不會受傷]", "2352"],
            ["[Ghost私房]", "1100"],
            ["[GirlFriendEnd]", "3439"],
            ["[Girlz-High]", "43"],
            ["[Glamarchive]", "4306"],
            ["[Graphis]", "15"],
            ["[H.J.Chamber作品集]", "2478"],
            ["[Hachi小芭]", "2255"],
            ["[Hana Bunny]", "2109"],
            ["[HaneAme 雨波]", "2444"],
            ["[Hegre-Art]", "903"],
            ["[Hidori Rose]", "2330"],
            ["[HIGH FANTASY]", "4279"],
            ["[Hokunaimeko]", "1700"],
            ["[HONGDAN]", "4760"],
            ["[HUAFOX系列]", "1811"],
            ["[HuaYang花漾]", "24"],
            ["[HuaYan花の颜]", "170"],
            ["[iAsian4u]", "1383"],
            ["[Idol Line]", "788"],
            ["[IKOF-6]", "4963"],
            ["[Ilogos アイロゴス]", "386"],
            ["[Image.tv]", "939"],
            ["[IMISS爱蜜社]", "160"],
            ["[IShow愛秀]", "2160"],
            ["[IVITAMIN系列]", "932"],
            ["[JOApictures]", "2872"],
            ["[Jooa]", "2283"],
            ["[JVID美模]", "1028"],
            ["[KaYa萱]", "2099"],
            ["[Kettoe]", "2375"],
            ["[KIMLEMON]", "3843"],
            ["[KIREI]", "4709"],
            ["[KiSiA]", "4421"],
            ["[KIYO キヨ]", "2431"],
            ["[KONELA]", "3213"],
            ["[Korean Realgraphic]", "3110"],
            ["[KuukoW クー子]", "2090"],
            ["[LEEHEE EXPRESS]", "2443"],
      ],
    );
  }
}
