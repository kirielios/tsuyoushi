// Port of keiyoushi/extensions-source lib-multisrc/mangahub/Filters.kt
import { Filter } from "../../sdk/index.ts";

export class Genre extends Filter.CheckBox {
  constructor(
    title: string,
    readonly key: string,
  ) {
    super(title);
  }
  override toString(): string {
    return this.name;
  }
}

export class Order extends Filter.TriState {
  constructor(
    title: string,
    readonly key: string,
  ) {
    super(title);
  }
  override toString(): string {
    return this.name;
  }
}

export class OrderBy extends Filter.Select<Order> {
  constructor(orders: Order[]) {
    super("Order", orders, 0);
  }
}

export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
  get included(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.key);
  }
}
