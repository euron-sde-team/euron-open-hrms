import { Repository } from "./repository";

/** Data access for `reminders`: a personal to-do layer, one owner per row. */
export class ReminderRepository extends Repository {
  /** One user's reminders. userId is a hot col (indexed). */
  forUser(userId: string) {
    return this.where({ userId }).list();
  }

  /** A reminder, only when it belongs to `userId` (anyone else's reads as missing). */
  async ownedBy(id: string, userId: string) {
    const r = await this.byId(id);
    return r && r.userId === userId ? r : null;
  }
}
