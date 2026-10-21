import { z } from "zod";
export const TERMS_VERSION = "draft-2026-10-21";
export function normalizePhone(value: string) {
  let phone = value.replace(/[\s()-]/g, "");
  if (phone.startsWith("08")) phone = `+62${phone.slice(1)}`;
  else if (phone.startsWith("62")) phone = `+${phone}`;
  else if (!phone.startsWith("+")) phone = `+${phone}`;
  return z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Nomor HP tidak valid.")
    .parse(phone);
}
export const profileInput = z
  .object({
    name: z.string().trim().min(3, "Nama minimal 3 karakter.").max(100),
    campusId: z.uuid(),
    acceptTerms: z.literal(true).optional(),
    avatarPath: z.string().max(300).optional(),
  })
  .strict();
export const providers = {
  bank: [
    "Mandiri",
    "BCA",
    "BRI",
    "BNI",
    "BSI",
    "CIMB Niaga",
    "Permata",
    "BTN",
    "Bank Jago",
    "SeaBank",
  ],
  ewallet: ["OVO", "GoPay", "DANA", "ShopeePay", "LinkAja"],
} as const;
export const payoutInput = z
  .object({
    type: z.enum(["bank", "ewallet"]),
    provider: z.string(),
    accountNo: z.string().regex(/^\d{8,20}$/, "Nomor rekening harus 8–20 digit."),
    accountName: z.string().trim().min(3).max(100),
  })
  .strict()
  .refine((v) => (providers[v.type] as readonly string[]).includes(v.provider), {
    message: "Pilih penyedia yang sesuai dengan jenis rekening.",
    path: ["provider"],
  });
export const verificationInput = z
  .object({
    cardType: z.enum(["ktm", "ktp"]),
    cardPhotoPath: z.string().max(300),
    selfiePath: z.string().max(300),
  })
  .strict();
export const decisionInput = z
  .object({
    decision: z.enum(["diterima", "ditolak"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== "ditolak" || (v.reason?.length ?? 0) >= 5, {
    message: "Tuliskan alasan penolakan minimal 5 karakter.",
    path: ["reason"],
  });
export const uploadInput = z
  .object({
    purpose: z.enum(["identity_card", "identity_selfie", "avatar"]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(5 * 1024 * 1024),
  })
  .strict();
