import { z } from "zod";
import { LISTING_LIMITS } from "@/src/domain/listing";
import { hoursSchema } from "@/src/domain/pickup-points";
import { SEARCH_SORTS } from "@/src/domain/search";
import { daysBetween } from "@/src/domain/availability";
import { rupiah } from "./utils";
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
    purpose: z.enum([
      "identity_card",
      "identity_selfie",
      "avatar",
      "item_photo",
      "payment_proof",
      "chat_image",
      "handover_photo",
      "dispute_evidence",
      "payout_proof",
      "cash_proof",
    ]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(5 * 1024 * 1024),
  })
  .strict()
  .refine(
    (v) =>
      v.contentType !== "application/pdf" ||
      ["payment_proof", "dispute_evidence", "payout_proof", "cash_proof"].includes(v.purpose),
    "PDF hanya boleh dipakai sebagai bukti transfer atau bukti sengketa.",
  );
const limits = LISTING_LIMITS;
const money = (label: string, min: number, max: number) =>
  z
    .number({ error: `Isi ${label.toLowerCase()}.` })
    .int(`${label} harus berupa rupiah tanpa desimal.`)
    .min(min, `${label} minimal ${rupiah(min)}.`)
    .max(max, `${label} maksimal ${rupiah(max)}.`);
const days = (label: string) =>
  z
    .number({ error: `Isi ${label.toLowerCase()}.` })
    .int()
    .min(limits.days.min, `${label} minimal ${limits.days.min} hari.`)
    .max(limits.days.max, `${label} maksimal ${limits.days.max} hari.`);
const uploadPath = z.string().min(1).max(300);
export const itemInput = z
  .object({
    title: z
      .string()
      .trim()
      .min(limits.title.min, `Judul minimal ${limits.title.min} karakter.`)
      .max(limits.title.max, `Judul maksimal ${limits.title.max} karakter.`),
    categoryId: z.uuid("Pilih kategori barang."),
    description: z
      .string()
      .trim()
      .min(
        limits.description.min,
        `Ceritakan kondisi barang minimal ${limits.description.min} karakter.`,
      )
      .max(limits.description.max, `Deskripsi maksimal ${limits.description.max} karakter.`),
    itemValue: money("Nilai barang", limits.itemValue.min, limits.itemValue.max),
    pricePerDay: money("Harga per hari", limits.pricePerDay.min, limits.pricePerDay.max),
    // The allowed deposit range depends on settings and is checked by the service.
    deposit: z
      .number({ error: "Isi deposit." })
      .int()
      .positive("Deposit tidak boleh nol.")
      .multipleOf(1000, "Deposit dibulatkan ke kelipatan Rp1.000."),
    minDays: days("Durasi minimal"),
    maxDays: days("Durasi maksimal"),
    pickupPointIds: z
      .array(z.uuid())
      .min(limits.pickupPoints.min, "Pilih minimal satu titik serah terima.")
      .max(limits.pickupPoints.max, `Pilih maksimal ${limits.pickupPoints.max} titik.`),
    photos: z
      .array(z.object({ path: uploadPath, thumbPath: uploadPath }).strict())
      .min(limits.photos.min, `Unggah minimal ${limits.photos.min} foto.`)
      .max(limits.photos.max, `Maksimal ${limits.photos.max} foto.`),
  })
  .strict()
  .refine((v) => v.maxDays >= v.minDays, {
    message: "Durasi maksimal harus sama atau lebih dari durasi minimal.",
    path: ["maxDays"],
  })
  .refine((v) => new Set(v.pickupPointIds).size === v.pickupPointIds.length, {
    message: "Titik serah terima tidak boleh dipilih dua kali.",
    path: ["pickupPointIds"],
  })
  .refine(
    (v) => {
      const paths = v.photos.flatMap((photo) => [photo.path, photo.thumbPath]);
      return new Set(paths).size === paths.length;
    },
    { message: "Foto yang sama tidak boleh dipakai dua kali.", path: ["photos"] },
  );
export type ItemInput = z.infer<typeof itemInput>;
export const itemDecisionInput = z
  .object({
    decision: z.enum(["disetujui", "ditolak"]),
    reason: z.string().trim().max(1000).optional(),
    // Version the admin reviewed; an owner edit in between invalidates the decision.
    version: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.decision !== "ditolak" || (v.reason?.length ?? 0) >= 5, {
    message: "Tuliskan alasan penolakan minimal 5 karakter.",
    path: ["reason"],
  });
const dateKey = z.iso.date("Pilih tanggal yang valid.");
export const blockInput = z
  .object({ from: dateKey, to: dateKey, reason: z.string().trim().max(200).optional() })
  .strict()
  .refine((v) => v.from <= v.to, {
    message: "Tanggal akhir harus sama dengan atau setelah tanggal mulai.",
    path: ["to"],
  });
const categoryName = z
  .string()
  .trim()
  .min(2, "Nama kategori minimal 2 karakter.")
  .max(60, "Nama kategori maksimal 60 karakter.");
export const categoryInput = z
  .object({ name: categoryName, active: z.boolean().optional() })
  .strict();
export const categoryPatch = z
  .object({ name: categoryName.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Pilih data kategori yang akan diubah.");
const pointFields = {
  name: z
    .string()
    .trim()
    .min(3, "Nama titik minimal 3 karakter.")
    .max(100, "Nama titik maksimal 100 karakter."),
  description: z.string().trim().max(500, "Keterangan maksimal 500 karakter."),
  hours: hoursSchema,
  active: z.boolean(),
};
export const pickupPointInput = z
  .object({
    campusId: z.uuid("Pilih kampus."),
    ...pointFields,
    description: pointFields.description.default(""),
    active: pointFields.active.optional(),
  })
  .strict();
// Campus is fixed after creation so listings never point to another campus.
export const pickupPointPatch = z
  .object({
    name: pointFields.name.optional(),
    description: pointFields.description.optional(),
    hours: pointFields.hours.optional(),
    active: pointFields.active.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Pilih data titik yang akan diubah.");
const blankToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);
const param = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
// Unknown query parameters (for example tracking tags) are ignored instead of rejected.
export const searchInput = z
  .object({
    q: param(z.string().trim().max(100, "Kata kunci maksimal 100 karakter.")),
    category: param(z.uuid("Kategori tidak valid.")),
    campus: param(z.uuid("Kampus tidak valid.")),
    point: param(z.uuid("Titik serah terima tidak valid.")),
    min: param(z.coerce.number().int().min(0).max(limits.pricePerDay.max)),
    max: param(z.coerce.number().int().min(0).max(limits.pricePerDay.max)),
    from: param(dateKey),
    to: param(dateKey),
    sort: param(z.enum(SEARCH_SORTS)),
    cursor: param(z.string().max(500)),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "Harga minimum tidak boleh melebihi harga maksimum.",
    path: ["max"],
  })
  .refine((v) => !v.from || !v.to || (v.from <= v.to && daysBetween(v.from, v.to) <= 90), {
    message: "Pilih rentang tanggal maksimal 90 hari.",
    path: ["to"],
  });
export type SearchInput = z.infer<typeof searchInput>;
