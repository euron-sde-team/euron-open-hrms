/**
 * Base class for every repository.
 *
 * A repository is the only code that reads or writes a collection. It wraps one
 * workspace-scoped store from base.repository.ts, which already guarantees the two
 * properties no caller may forget:
 *
 *   - tenant isolation: every query carries `org_id = <the caller's workspace>`
 *   - personal data at rest: sensitive fields are sealed on write and opened on read
 *
 * Subclasses add the queries their domain needs (findByEmail, activeInDepartment, ...)
 * so services speak the domain's language instead of building predicates inline.
 */
export type Row = Record<string, any> & { id: string };

/** The workspace-scoped store a repository wraps (see base.repository.ts). */
export interface ScopedStore {
  all(): Promise<Row[]>;
  find(pred?: (r: Row) => boolean): Promise<Row[]>;
  findOne(pred: (r: Row) => boolean): Promise<Row | null>;
  byId(id: string): Promise<Row | null>;
  count(pred?: (r: Row) => boolean): Promise<number>;
  page(opts: Record<string, unknown>): Promise<{ items: Row[]; total: number; page: number; pageSize: number; pages: number }>;
  insert(doc: Record<string, any>): Promise<Row>;
  insertMany(docs: Record<string, any>[]): Promise<Row[]>;
  update(id: string, patch: Record<string, any>): Promise<Row | null>;
  remove(id: string): Promise<boolean>;
  removeWhere(filter: Record<string, unknown>): Promise<number>;
  where(filter: Record<string, unknown>): { list(): Promise<Row[]>; one(): Promise<Row | null>; count(): Promise<number> };
}

export class Repository<T extends Row = Row> {
  constructor(protected readonly store: ScopedStore) {}

  /** Every row in the workspace. Prefer `where` on hot columns for large collections. */
  all(): Promise<T[]> {
    return this.store.all() as Promise<T[]>;
  }
  find(pred?: (r: T) => boolean): Promise<T[]> {
    return this.store.find(pred as any) as Promise<T[]>;
  }
  findOne(pred: (r: T) => boolean): Promise<T | null> {
    return this.store.findOne(pred as any) as Promise<T | null>;
  }
  byId(id: string): Promise<T | null> {
    return this.store.byId(id) as Promise<T | null>;
  }
  count(pred?: (r: T) => boolean): Promise<number> {
    return this.store.count(pred as any);
  }
  page(opts: Record<string, unknown>) {
    return this.store.page(opts) as Promise<{ items: T[]; total: number; page: number; pageSize: number; pages: number }>;
  }
  /** Equality filter pushed into SQL; only hot columns are allowed. */
  where(filter: Record<string, unknown>) {
    return this.store.where(filter) as { list(): Promise<T[]>; one(): Promise<T | null>; count(): Promise<number> };
  }
  create(doc: Partial<T> & Record<string, any>): Promise<T> {
    return this.store.insert(doc) as Promise<T>;
  }
  createMany(docs: Record<string, any>[]): Promise<T[]> {
    return this.store.insertMany(docs) as Promise<T[]>;
  }
  update(id: string, patch: Record<string, any>): Promise<T | null> {
    return this.store.update(id, patch) as Promise<T | null>;
  }
  remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }
  removeWhere(filter: Record<string, unknown>): Promise<number> {
    return this.store.removeWhere(filter);
  }
}
