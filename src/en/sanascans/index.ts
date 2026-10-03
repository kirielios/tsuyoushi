// Port of keiyoushi/extensions-source src/en/sanascans/SanaScans.kt
import { Iken } from "../../../themes/iken/index.ts";

export default class SanaScans extends Iken {
  protected override perPage = 30;
  protected override sortPagesByFilename = true;
}
