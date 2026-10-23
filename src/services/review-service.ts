import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import { rentals, reviews, users, type User } from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { reviewInput } from "@/src/lib/trust-validation";
import { lockRental, participantRental } from "./rental-service";
import { lockAccountActivity } from "./account-activity";

// Serialize aggregates across different listings of the same owner. Hidden content never counts.
export async function refreshRatings(tx: Executor, rentalId: string) {
  const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId));
  await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, [rental.ownerId, rental.renterId]))
    .orderBy(asc(users.id))
    .for("no key update");
  await tx.execute(
    sql`UPDATE users u SET rating_count=(SELECT count(*) FROM reviews r WHERE r.reviewee_id=u.id AND r.visible_at IS NOT NULL AND r.hidden_at IS NULL), rating_avg=coalesce((SELECT round(avg(score)*100)::int FROM reviews r WHERE r.reviewee_id=u.id AND r.visible_at IS NOT NULL AND r.hidden_at IS NULL),0) WHERE u.id IN (${rental.ownerId}::uuid,${rental.renterId}::uuid)`,
  );
  await tx.execute(
    sql`UPDATE items i SET rating_count=(SELECT count(*) FROM reviews r JOIN rentals t ON t.id=r.rental_id WHERE t.item_id=i.id AND r.reviewer_id=t.renter_id AND r.visible_at IS NOT NULL AND r.hidden_at IS NULL), rating_avg=coalesce((SELECT round(avg(r.score)*100)::int FROM reviews r JOIN rentals t ON t.id=r.rental_id WHERE t.item_id=i.id AND r.reviewer_id=t.renter_id AND r.visible_at IS NOT NULL AND r.hidden_at IS NULL),0) WHERE i.id=${rental.itemId}::uuid`,
  );
}
export async function rentalReviews(db: Executor, actor: User, id: string) {
  const rental = await participantRental(db, actor, id),
    endsAt = rental.settledAt
      ? new Date(rental.settledAt.getTime() + rental.rulesSnapshot.rating_window_days * 86400000)
      : null;
  const rows = await db.select().from(reviews).where(eq(reviews.rentalId, id));
  const mine = rows.find((r) => r.reviewerId === actor.id);
  return {
    endsAt,
    canReview:
      ["PENCAIRAN_DIPROSES", "SELESAI"].includes(rental.status) &&
      Boolean(endsAt && endsAt > new Date()) &&
      !mine?.visibleAt,
    mine: mine
      ? {
          id: mine.id,
          score: mine.score,
          tags: mine.tags,
          comment: mine.comment,
          visibleAt: mine.visibleAt,
        }
      : null,
    // Exclude even the existence, score and tags of a hidden counterpart review.
    received: rows
      .filter((r) => r.revieweeId === actor.id && r.visibleAt && !r.hiddenAt)
      .map((r) => ({
        id: r.id,
        score: r.score,
        tags: r.tags,
        comment: r.comment,
        visibleAt: r.visibleAt,
      })),
  };
}
export async function submitReview(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  const input = reviewInput.parse(raw);
  return mutation(db, actor.id, `rental:${id}:review`, key, input, async (tx) => {
    const reference = await participantRental(tx, actor, id);
    await lockAccountActivity(tx, [reference.ownerId, reference.renterId]);
    const [person] = await tx.select().from(users).where(eq(users.id, actor.id));
    assert(person.accountStatus !== "dihapus", "ACCOUNT_UNAVAILABLE", "Akun tidak tersedia.", 403);
    const rental = await lockRental(tx, id);
    assert(
      [rental.ownerId, rental.renterId].includes(actor.id),
      "NOT_FOUND",
      "Transaksi tidak ditemukan.",
      404,
    );
    const ends =
      rental.settledAt &&
      rental.settledAt.getTime() + rental.rulesSnapshot.rating_window_days * 86400000;
    assert(
      ["PENCAIRAN_DIPROSES", "SELESAI"].includes(rental.status) && ends && ends > Date.now(),
      "REVIEW_CLOSED",
      "Ulasan hanya tersedia selama masa penilaian setelah pengembalian final.",
      409,
    );
    const rows = await tx.select().from(reviews).where(eq(reviews.rentalId, id));
    const mine = rows.find((r) => r.reviewerId === actor.id);
    assert(
      !mine?.visibleAt,
      "REVIEW_VISIBLE",
      "Ulasan yang sudah terlihat tidak dapat diubah.",
      409,
    );
    const [saved] = await tx
      .insert(reviews)
      .values({
        rentalId: id,
        reviewerId: actor.id,
        revieweeId: actor.id === rental.ownerId ? rental.renterId : rental.ownerId,
        ...input,
      })
      .onConflictDoUpdate({ target: [reviews.rentalId, reviews.reviewerId], set: input })
      .returning();
    if (rows.some((r) => r.reviewerId !== actor.id)) {
      await tx
        .update(reviews)
        .set({ visibleAt: new Date() })
        .where(and(eq(reviews.rentalId, id), isNull(reviews.visibleAt)));
      await refreshRatings(tx, id);
    }
    return { id: saved.id };
  });
}
export async function publicReviews(db: Executor, filter: { userId?: string; itemId?: string }) {
  return db
    .select({
      id: reviews.id,
      score: reviews.score,
      tags: reviews.tags,
      comment: reviews.comment,
      visibleAt: reviews.visibleAt,
      reviewerName: users.name,
      reviewerId: users.id,
    })
    .from(reviews)
    .innerJoin(rentals, eq(rentals.id, reviews.rentalId))
    .innerJoin(users, eq(users.id, reviews.reviewerId))
    .where(
      and(
        isNotNull(reviews.visibleAt),
        isNull(reviews.hiddenAt),
        filter.userId ? eq(reviews.revieweeId, filter.userId) : undefined,
        filter.itemId
          ? and(eq(rentals.itemId, filter.itemId), eq(reviews.reviewerId, rentals.renterId))
          : undefined,
      ),
    )
    .orderBy(asc(reviews.visibleAt), asc(reviews.id))
    .limit(100);
}
export async function revealReviews(db: Database) {
  const rows = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        inArray(rentals.status, ["PENCAIRAN_DIPROSES", "SELESAI"]),
        sql`${rentals.settledAt} + (${rentals.rulesSnapshot}->>'rating_window_days')::int * interval '1 day' <= now()`,
        sql`EXISTS(SELECT 1 FROM reviews WHERE rental_id=${rentals.id} AND visible_at IS NULL)`,
      ),
    )
    .limit(100);
  let revealed = 0;
  for (const { id } of rows)
    await db.transaction(async (tx) => {
      const [reference] = await tx.select().from(rentals).where(eq(rentals.id, id));
      await lockAccountActivity(tx, [reference.ownerId, reference.renterId]);
      await lockRental(tx, id);
      const changed = await tx
        .update(reviews)
        .set({ visibleAt: new Date() })
        .where(and(eq(reviews.rentalId, id), isNull(reviews.visibleAt)))
        .returning();
      if (changed.length) {
        await refreshRatings(tx, id);
        revealed += changed.length;
      }
    });
  return { revealed };
}
