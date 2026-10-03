// Port of keiyoushi/extensions-source src/all/misskon/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SourceCategory {
  constructor(
    private readonly name: string,
    readonly url: string,
  ) {}
  toString() {
    return this.name;
  }
}

const CategoryPresets = {
  TOP: [
    new SourceCategory("Top 3 days", "/top3/"),
    new SourceCategory("Top 7 days", "/top7/"),
    new SourceCategory("Top 30 days", "/top30/"),
    new SourceCategory("Top 60 days", "/top60/"),
  ],
  CHINESE: [
    new SourceCategory("Chinese:[MTCos] 喵糖映画", "/tag/mtcos/"),
    new SourceCategory("Chinese:BoLoli", "/tag/bololi/"),
    new SourceCategory("Chinese:CANDY", "/tag/candy/"),
    new SourceCategory("Chinese:FEILIN", "/tag/feilin/"),
    new SourceCategory("Chinese:FToow", "/tag/ftoow/"),
    new SourceCategory("Chinese:GIRLT", "/tag/girlt/"),
    new SourceCategory("Chinese:HuaYan", "/tag/huayan/"),
    new SourceCategory("Chinese:HuaYang", "/tag/huayang/"),
    new SourceCategory("Chinese:IMISS", "/tag/imiss/"),
    new SourceCategory("Chinese:ISHOW", "/tag/ishow/"),
    new SourceCategory("Chinese:JVID", "/tag/jvid/"),
    new SourceCategory("Chinese:KelaGirls", "/tag/kelagirls/"),
    new SourceCategory("Chinese:Kimoe", "/tag/kimoe/"),
    new SourceCategory("Chinese:LegBaby", "/tag/legbaby/"),
    new SourceCategory("Chinese:MF", "/tag/mf/"),
    new SourceCategory("Chinese:MFStar", "/tag/mfstar/"),
    new SourceCategory("Chinese:MiiTao", "/tag/miitao/"),
    new SourceCategory("Chinese:MintYe", "/tag/mintye/"),
    new SourceCategory("Chinese:MISSLEG", "/tag/missleg/"),
    new SourceCategory("Chinese:MiStar", "/tag/mistar/"),
    new SourceCategory("Chinese:MTMeng", "/tag/mtmeng/"),
    new SourceCategory("Chinese:MyGirl", "/tag/mygirl/"),
    new SourceCategory("Chinese:PartyCat", "/tag/partycat/"),
    new SourceCategory("Chinese:QingDouKe", "/tag/qingdouke/"),
    new SourceCategory("Chinese:RuiSG", "/tag/ruisg/"),
    new SourceCategory("Chinese:SLADY", "/tag/slady/"),
    new SourceCategory("Chinese:TASTE", "/tag/taste/"),
    new SourceCategory("Chinese:TGOD", "/tag/tgod/"),
    new SourceCategory("Chinese:TouTiao", "/tag/toutiao/"),
    new SourceCategory("Chinese:TuiGirl", "/tag/tuigirl/"),
    new SourceCategory("Chinese:Tukmo", "/tag/tukmo/"),
    new SourceCategory("Chinese:UGIRLS", "/tag/ugirls/"),
    new SourceCategory("Chinese:UGIRLS - Ai You Wu App", "/tag/ugirls-ai-you-wu-app/"),
    new SourceCategory("Chinese:UXING", "/tag/uxing/"),
    new SourceCategory("Chinese:WingS", "/tag/wings/"),
    new SourceCategory("Chinese:XiaoYu", "/tag/xiaoyu/"),
    new SourceCategory("Chinese:XingYan", "/tag/xingyan/"),
    new SourceCategory("Chinese:XIUREN", "/tag/xiuren/"),
    new SourceCategory("Chinese:XR Uncensored", "/tag/xr-uncensored/"),
    new SourceCategory("Chinese:YouMei", "/tag/youmei/"),
    new SourceCategory("Chinese:YouMi", "/tag/youmi/"),
    new SourceCategory("Chinese:YouMi尤蜜", "/tag/youmiapp/"),
    new SourceCategory("Chinese:YouWu", "/tag/youwu/"),
  ],
  KOREAN: [
    new SourceCategory("Korean:AG", "/tag/ag/"),
    new SourceCategory("Korean:Bimilstory", "/tag/bimilstory/"),
    new SourceCategory("Korean:BLUECAKE", "/tag/bluecake/"),
    new SourceCategory("Korean:CreamSoda", "/tag/creamsoda/"),
    new SourceCategory("Korean:DJAWA", "/tag/djawa/"),
    new SourceCategory("Korean:Espacia Korea", "/tag/espacia-korea/"),
    new SourceCategory("Korean:Fantasy Factory", "/tag/fantasy-factory/"),
    new SourceCategory("Korean:Fantasy Story", "/tag/fantasy-story/"),
    new SourceCategory("Korean:Glamarchive", "/tag/glamarchive/"),
    new SourceCategory("Korean:HIGH FANTASY", "/tag/high-fantasy/"),
    new SourceCategory("Korean:KIMLEMON", "/tag/kimlemon/"),
    new SourceCategory("Korean:KIREI", "/tag/kirei/"),
    new SourceCategory("Korean:KiSiA", "/tag/kisia/"),
    new SourceCategory("Korean:Korean Realgraphic", "/tag/korean-realgraphic/"),
    new SourceCategory("Korean:Lilynah", "/tag/lilynah/"),
    new SourceCategory("Korean:Lookas", "/tag/lookas/"),
    new SourceCategory("Korean:Loozy", "/tag/loozy/"),
    new SourceCategory("Korean:Moon Night Snap", "/tag/moon-night-snap/"),
    new SourceCategory("Korean:Paranhosu", "/tag/paranhosu/"),
    new SourceCategory("Korean:PhotoChips", "/tag/photochips/"),
    new SourceCategory("Korean:Pure Media", "/tag/pure-media/"),
    new SourceCategory("Korean:PUSSYLET", "/tag/pussylet/"),
    new SourceCategory("Korean:SAINT Photolife", "/tag/saint-photolife/"),
    new SourceCategory("Korean:SWEETBOX", "/tag/sweetbox/"),
    new SourceCategory("Korean:UHHUNG MAGAZINE", "/tag/uhhung-magazine/"),
    new SourceCategory("Korean:UMIZINE", "/tag/umizine/"),
    new SourceCategory("Korean:WXY ENT", "/tag/wxy-ent/"),
    new SourceCategory("Korean:Yo-U", "/tag/yo-u/"),
  ],
  OTHER: [
    new SourceCategory("Other:AI Generated", "/tag/ai-generated/"),
    new SourceCategory("Other:Cosplay", "/tag/cosplay/"),
    new SourceCategory("Other:JP", "/tag/jp/"),
    new SourceCategory("Other:JVID", "/tag/jvid/"),
    new SourceCategory("Other:Patreon", "/tag/patreon/"),
  ],
};

export class SourceCategorySelector extends Filter.Select<SourceCategory> {
  get selectedCategory(): SourceCategory | null {
    return this.state > 0 ? this.values[this.state] : null;
  }

  static create(): SourceCategorySelector {
    const options = [new SourceCategory("unselected", ""), ...CategoryPresets.TOP, ...CategoryPresets.CHINESE, ...CategoryPresets.KOREAN, ...CategoryPresets.OTHER];
    return new SourceCategorySelector("Category", options);
  }
}
