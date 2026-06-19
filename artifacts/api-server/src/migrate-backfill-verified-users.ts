import { db } from "./lib/db";
import { users } from "@workspace/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export interface BackfillVerifiedUsersResult {
  checked: number;
  updated: number;
}

/**
 * Idempotent startup migration: marks all users that have no pending
 * verification token as verified=true.
 *
 * This safely grandfathers in every account that existed before email
 * verification was introduced, because those rows have verification_token=NULL
 * (it was never set) and is_verified=false (column default at creation time).
 */
export async function runBackfillVerifiedUsers(): Promise<BackfillVerifiedUsersResult> {
  const unverified = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isVerified, false), isNull(users.verificationToken)));

  if (unverified.length === 0) {
    return { checked: 0, updated: 0 };
  }

  const ids = unverified.map((u) => u.id);

  await db
    .update(users)
    .set({ isVerified: true, updatedAt: new Date() })
    .where(sql`${users.id} = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::int[])`);

  return { checked: ids.length, updated: ids.length };
}
