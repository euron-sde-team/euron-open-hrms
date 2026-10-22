import { Repository } from "./repository";

/** Data access for `holidays`: the workspace's leave calendar. */
export class HolidayRepository extends Repository {
  /** The calendar in date order, optionally only one year. */
  async chronological(year?: string) {
    let list = await this.all();
    if (year) list = list.filter((h) => String(h.date).startsWith(year));
    return list.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
}
