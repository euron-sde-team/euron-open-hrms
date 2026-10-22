import { Repository } from "./repository";

/** Data access for `notifications`. */
export class NotificationRepository extends Repository {
  /**
   * One user's notifications. The userId filter is pushed into SQL (indexed) instead of
   * scanning the whole org's notifications in JS; the per-user set is small, so callers
   * filter, sort and limit it cheaply in memory.
   */
  forUser(userId: string) {
    return this.where({ userId }).list();
  }

  /** One user's unread notifications (userId in SQL, unread-filtered on the small per-user set). */
  async unreadForUser(userId: string) {
    return (await this.forUser(userId)).filter((n) => !n.readAt);
  }
}
