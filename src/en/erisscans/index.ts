// Port of keiyoushi/extensions-source src/en/erisscans/ErisScans.kt
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class ErisScans extends Keyoapp {
  protected override altNameSelector = "div.font-medium:containsOwn(Alternative titles) ~ div span.select-all";
  protected override statusSelector = "div[alt=Status]";
  protected override authorSelector = "div[alt=Author]";
  protected override artistSelector = "div[alt=Artist]";
  protected override typeSelector = "div[alt='Series Type']";
}
