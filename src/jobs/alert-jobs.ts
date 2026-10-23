import { and, eq, gt, lt, lte, ne, sql, type Column, type SQL } from "drizzle-orm";
import type { Database } from "@/src/db";
import {
  disputes,
  identityVerifications,
  items,
  payments,
  payoutTasks,
  rentals,
  rescheduleRequests,
  sentAlerts,
} from "@/src/db/schema";
import { HANDOVER_RULES } from "@/src/domain/handover";
import { dateWib } from "@/src/lib/utils";
import { notify, notifyAdmins } from "@/src/services/notification-service";
import { getSettings } from "@/src/services/settings-service";

const HOUR = 3600000;
// The schedule is part of the key, so a rescheduled rental gets fresh reminders.
async function remindOnce(
  db: Database,
  kind: string,
  targetId: string,
  messages: { userId: string; type: string; title: string; body: string; link: string }[],
) {
  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(sentAlerts)
      .values({ kind, targetId })
      .onConflictDoNothing()
      .returning();
    if (!fresh) return 0;
    for (const message of messages)
      await notify(tx, message.userId, message.type, message.title, message.body, message.link);
    return 1;
  });
}
// F15 reminders: payment deadline, handover H-1 and 1 hour, due H-1 and 2 hours, check window.
export async function reminders(db: Database) {
  const now = Date.now(),
    within = (column: Column, ms: number) =>
      and(gt(column, new Date(now)), lte(column, new Date(now + ms)));
  let sent = 0;
  const select = () =>
    db
      .select({
        id: rentals.id,
        code: rentals.publicCode,
        ownerId: rentals.ownerId,
        renterId: rentals.renterId,
        startAt: rentals.startAt,
        dueAt: rentals.dueAt,
        payBy: rentals.payBy,
        reviewEndsAt: rentals.reviewEndsAt,
      })
      .from(rentals);
  for (const r of await select().where(
    and(eq(rentals.status, "DISETUJUI"), within(rentals.payBy, HOUR)),
  ))
    sent += await remindOnce(db, `pay_1h@${r.payBy!.toISOString()}`, r.id, [
      {
        userId: r.renterId,
        type: "rental_reminder",
        title: "Batas bayar tinggal 1 jam",
        body: `${r.code}: unggah bukti transfer sebelum ${dateWib(r.payBy!)}.`,
        link: `/transaksi/${r.id}`,
      },
    ]);
  for (const r of await select().where(
    and(eq(rentals.status, "DIBAYAR"), within(rentals.startAt, 24 * HOUR)),
  )) {
    const soon = r.startAt.getTime() - now <= HOUR;
    sent += await remindOnce(
      db,
      `${soon ? "handover_1h" : "handover_h1"}@${r.startAt.toISOString()}`,
      r.id,
      [r.ownerId, r.renterId].map((userId) => ({
        userId,
        type: "rental_reminder",
        title: soon ? "Serah terima 1 jam lagi" : "Serah terima besok",
        body: `${r.code}: bertemu di titik serah terima ${dateWib(r.startAt)}.`,
        link: `/transaksi/${r.id}`,
      })),
    );
  }
  for (const r of await select().where(
    and(eq(rentals.status, "BERJALAN"), within(rentals.dueAt, 24 * HOUR)),
  )) {
    const soon = r.dueAt.getTime() - now <= 2 * HOUR;
    sent += await remindOnce(db, `${soon ? "due_2h" : "due_h1"}@${r.dueAt.toISOString()}`, r.id, [
      {
        userId: r.renterId,
        type: "rental_reminder",
        title: soon ? "Jatuh tempo 2 jam lagi" : "Jatuh tempo besok",
        body: `${r.code}: kembalikan barang sebelum ${dateWib(r.dueAt)} agar tidak kena denda.`,
        link: `/transaksi/${r.id}`,
      },
    ]);
  }
  // In-app only: the check window is not in the Telegram column of F15.
  for (const r of await select().where(
    and(eq(rentals.status, "DIKEMBALIKAN"), within(rentals.reviewEndsAt, 2 * HOUR)),
  ))
    sent += await remindOnce(
      db,
      "review_ending",
      r.id,
      [r.ownerId, r.renterId].map((userId) => ({
        userId,
        type: "review_ending",
        title: "Masa cek segera berakhir",
        body: `${r.code}: laporkan masalah sebelum ${dateWib(r.reviewEndsAt!)}; setelah itu dana dicairkan.`,
        link: `/transaksi/${r.id}`,
      })),
    );
  // Proposals that can no longer be met expire quietly.
  const expired = await db
    .update(rescheduleRequests)
    .set({ status: "kedaluwarsa", respondedAt: new Date(now) })
    .where(
      and(
        eq(rescheduleRequests.status, "menunggu"),
        lt(
          rescheduleRequests.newStartAt,
          new Date(now + HANDOVER_RULES.rescheduleLeadMinutes * 60000),
        ),
      ),
    )
    .returning({ id: rescheduleRequests.id });
  return { sent, expiredReschedules: expired.length };
}
const notAlerted = (kind: string, id: SQL) =>
  sql`NOT EXISTS (SELECT 1 FROM sent_alerts a WHERE a.kind = ${kind} AND a.target_id = ${id})`;
// One admin-group message per queue per run for tasks that newly passed their target (F15).
export async function slaFlags(db: Database) {
  const rules = await getSettings(db),
    now = new Date();
  const queues: {
    kind: string;
    label: string;
    link: string;
    ids: () => Promise<{ id: string }[]>;
  }[] = [
    {
      kind: "sla:payment",
      label: "bukti pembayaran",
      link: "/admin/pembayaran",
      ids: () =>
        db
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.status, "menunggu"),
              lt(payments.targetAt, now),
              notAlerted("sla:payment", sql`"payments"."id"`),
            ),
          )
          .limit(100),
    },
    {
      kind: "sla:payout",
      label: "tugas pencairan",
      link: "/admin/pencairan",
      ids: () =>
        db
          .select({ id: payoutTasks.id })
          .from(payoutTasks)
          .where(
            and(
              ne(payoutTasks.status, "selesai"),
              lt(payoutTasks.targetAt, now),
              notAlerted("sla:payout", sql`"payout_tasks"."id"`),
            ),
          )
          .limit(100),
    },
    {
      kind: "sla:dispute",
      label: "sengketa",
      link: "/admin/sengketa",
      ids: () =>
        db
          .select({ id: disputes.id })
          .from(disputes)
          .where(
            and(
              eq(disputes.status, "dibuka"),
              lt(disputes.decideBy, now),
              notAlerted("sla:dispute", sql`"disputes"."id"`),
            ),
          )
          .limit(100),
    },
    {
      kind: "sla:identity",
      label: "verifikasi identitas",
      link: "/admin/verifikasi",
      ids: () =>
        db
          .select({ id: identityVerifications.id })
          .from(identityVerifications)
          .where(
            and(
              eq(identityVerifications.status, "menunggu"),
              lt(
                identityVerifications.createdAt,
                new Date(now.getTime() - rules.identity_sla_hours * HOUR),
              ),
              notAlerted("sla:identity", sql`"identity_verifications"."id"`),
            ),
          )
          .limit(100),
    },
    {
      kind: "sla:listing",
      label: "moderasi listing",
      link: "/admin/listing",
      ids: () =>
        db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.status, "menunggu_review"),
              lt(items.submittedAt, new Date(now.getTime() - rules.listing_sla_hours * HOUR)),
              notAlerted("sla:listing", sql`"items"."id"`),
            ),
          )
          .limit(100),
    },
  ];
  let flagged = 0;
  for (const queue of queues) {
    const rows = await queue.ids();
    if (!rows.length) continue;
    await db.transaction(async (tx) => {
      const fresh = await tx
        .insert(sentAlerts)
        .values(rows.map(({ id }) => ({ kind: queue.kind, targetId: id })))
        .onConflictDoNothing()
        .returning({ id: sentAlerts.targetId });
      if (!fresh.length) return;
      flagged += fresh.length;
      await notifyAdmins(
        tx,
        "Antrean lewat target",
        `${fresh.length} ${queue.label} melewati target waktu. Segera tangani.`,
        queue.link,
      );
    });
  }
  return { flagged };
}
