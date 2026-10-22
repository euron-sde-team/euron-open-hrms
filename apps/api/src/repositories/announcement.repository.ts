import { Repository } from "./repository";

/** Data access for `announcements`. */
export class AnnouncementRepository extends Repository {
  /** The notice board order: pinned first, then newest. */
  async pinnedFirst() {
    return (await this.all())
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.createdAt < b.createdAt ? 1 : -1));
  }
}
