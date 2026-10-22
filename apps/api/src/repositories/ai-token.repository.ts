import { Repository } from "./repository";

/** Data access for `ai_tokens`: one AI usage allowance per employee. */
export class AiTokenRepository extends Repository {
  /** Indexed lookup on the employeeId hot column (not a full-table scan). */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).one();
  }
}
