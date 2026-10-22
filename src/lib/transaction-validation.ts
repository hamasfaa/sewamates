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
export const rentalActionInput = z
  .object({ version: z.number().int().positive(), reason: z.string().trim().max(1000).optional() })
  .strict();
export const paymentInput = z
  .object({
    platformAccountId: z.uuid("Pilih rekening tujuan."),
    proofPath: z.string().min(1).max(300),
    senderName: z.string().trim().min(2).max(100),
    transferredAt: z.iso.datetime({ offset: true }),
    claimedAmount: money,
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
