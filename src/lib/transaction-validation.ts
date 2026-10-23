import { z } from "zod";
import { payoutInput } from "./validation";
const money = z.number().int().positive().max(10_000_000_000);
export const rentalInput = z
  .object({
    itemId: z.uuid(),
    pickupPointId: z.uuid("Pilih titik serah terima."),
    startAt: z.iso.datetime({ offset: true }),
    days: z.number().int().min(1).max(90),
    message: z.string().trim().max(1000).optional(),
  })
  .strict();
const version = z.number().int().positive();
export const rentalActionInput = z
  .object({
    version,
    reason: z.string().trim().max(1000).optional(),
    // The cancellation fee the user saw; a different server result asks them to review again.
    fee: z.number().int().min(0).max(10_000_000_000).optional(),
  })
  .strict();
const evidencePath = z.string().min(1).max(300);
const evidencePaths = z.array(evidencePath).max(30).default([]);
const description = z.string().trim().min(20, "Jelaskan masalahnya minimal 20 karakter.").max(2000);
export const arriveInput = z
  .object({
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000),
      })
      .strict()
      .optional(),
  })
  .strict();
export const handoverPhotoInput = z
  .object({ path: evidencePath, source: z.enum(["camera", "gallery"]) })
  .strict();
export const handoverConfirmInput = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Kode terdiri dari 6 angka."),
    photosConfirmed: z.boolean().optional(),
  })
  .strict();
// tidak_hadir disputes only come from contesting a no-show report or from the system.
const disputeFields = {
  category: z.enum(["rusak", "hilang", "telat", "tidak_sesuai", "lainnya"], "Pilih jenis masalah."),
  description,
  evidencePaths,
};
export const disputeInput = z.object(disputeFields).strict();
export const checkInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("sesuai") }).strict(),
  z.object({ decision: z.literal("masalah"), ...disputeFields }).strict(),
]);
export const noShowContestInput = z.object({ description, evidencePaths }).strict();
export const evidenceInput = z
  .object({
    paths: z.array(evidencePath).min(1).max(30),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export const rescheduleInput = z
  .object({ version, startAt: z.iso.datetime({ offset: true }) })
  .strict();
export const rescheduleResponseInput = z
  .object({ version, decision: z.enum(["disetujui", "ditolak"]) })
  .strict();
export const payoutQueueInput = z
  .object({
    state: z.enum(["open", "done"]).default("open"),
    sla: z.enum(["all", "overdue", "on_time"]).default("all"),
    q: z.string().trim().max(100).default(""),
  })
  .strict();
const fee = z.number().int().min(0).max(1_000_000);
export const payoutCompleteInput = z
  .object({
    sourceAccountId: z.uuid("Pilih rekening platform sumber."),
    transferredAmount: money,
    transferFee: fee,
    transferredAt: z.iso.datetime({ offset: true }),
    proofPath: evidencePath,
  })
  .strict();
export const cashMovementInput = z
  .object({
    fromAccountId: z.uuid("Pilih rekening asal."),
    toAccountId: z.uuid("Pilih rekening tujuan."),
    amount: money,
    fee: fee.default(0),
    proofPath: evidencePath,
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.fromAccountId !== v.toAccountId, "Rekening asal dan tujuan harus berbeda.");
export const paymentInput = z
  .object({
    platformAccountId: z.uuid("Pilih rekening tujuan."),
    proofPath: z.string().min(1).max(300),
    senderName: z.string().trim().min(2).max(100),
    transferredAt: z.iso.datetime({ offset: true }),
    claimedAmount: money,
  })
  .strict();
export const paymentQueueInput = z
  .object({
    q: z.string().trim().max(100).default(""),
    sla: z.enum(["all", "overdue", "on_time"]).default("all"),
  })
  .strict();
export const paymentDecisionInput = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(["diterima", "ditolak"]),
    verifiedAmount: money.optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (v) => v.decision !== "diterima" || v.verifiedAmount !== undefined,
    "Isi nominal yang benar-benar masuk.",
  )
  .refine(
    (v) => v.decision !== "ditolak" || (v.reason?.length || 0) >= 5,
    "Tuliskan alasan penolakan minimal 5 karakter.",
  );
export const platformAccountInput = payoutInput.safeExtend({ active: z.boolean().default(true) });
export const chatInput = z
  .object({
    body: z.string().trim().max(2000).optional(),
    imagePath: z.string().min(1).max(300).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.body) !== Boolean(v.imagePath), "Kirim teks atau satu gambar.");
