import { z } from "zod";
const money = z.number().int().min(0).max(100000000000);
export const disputeResponseInput = z
  .object({
    body: z.string().trim().min(20).max(3000),
    paths: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();
export const disputeDecisionInput = z
  .object({
    version: z.number().int().positive(),
    outcome: z.enum(["lanjutkan", "batal", "bagi_dana"]),
    reason: z.string().trim().min(20).max(3000),
    ownerAmount: money.default(0),
    renterAmount: money.default(0),
    newStartAt: z.iso.datetime().optional(),
    strikeUserId: z.uuid().optional(),
  })
  .strict();
export const REVIEW_TAGS = [
  "tepat waktu",
  "barang sesuai deskripsi",
  "merawat barang",
  "komunikatif",
] as const;
export const reviewInput = z
  .object({
    score: z.number().int().min(1).max(5),
    tags: z
      .array(z.enum(REVIEW_TAGS))
      .max(4)
      .transform((v) => [...new Set(v)])
      .default([]),
    comment: z.string().trim().max(500).default(""),
  })
  .strict();
export const reportInput = z
  .object({
    targetType: z.enum(["user", "item", "message", "review"]),
    targetId: z.uuid(),
    reason: z.string().trim().min(5).max(1000),
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export const reportActionInput = z
  .object({
    action: z.enum(["abaikan", "sembunyikan", "strike", "tangguhkan"]),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export const reasonInput = z.object({ reason: z.string().trim().min(10).max(2000) }).strict();
export const adjustmentInput = z
  .object({
    originalTaskId: z.uuid(),
    amount: money.refine((v) => v > 0),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const withdrawalInput = z
  .object({
    fromAccountId: z.uuid(),
    amount: money.refine((v) => v > 0),
    proofPath: z.string().max(300),
    note: z.string().trim().min(10).max(500),
  })
  .strict();
export const reconciliationInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    platformAccountId: z.uuid(),
    actualBalance: money,
    note: z.string().trim().max(500).default(""),
  })
  .strict();
