import { Repository } from "./repository";

/** Data access for `saved_views`. */
export class SavedViewRepository extends Repository {
  /** One user's saved views, optionally for one resource. userId and resource are hot columns, so both filter in SQL. */
  forUser(userId: string, resource?: unknown) {
    const filter: Record<string, unknown> = { userId };
    if (resource) filter.resource = resource;
    return this.where(filter).list();
  }
}
