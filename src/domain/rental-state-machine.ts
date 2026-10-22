export const RENTAL_STATUSES = [
  "DIAJUKAN",
  "DISETUJUI",
  "MENUNGGU_VERIFIKASI",
  "DIBAYAR",
  "BERJALAN",
  "DIKEMBALIKAN",
  "SENGKETA",
  "PENCAIRAN_DIPROSES",
  "SELESAI",
  "DITOLAK",
  "KADALUARSA",
  "DIBATALKAN",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export const HOLD_STATUSES: RentalStatus[] = [
  "DISETUJUI",
  "MENUNGGU_VERIFIKASI",
  "DIBAYAR",
  "BERJALAN",
];
export const FINAL_STATUSES: RentalStatus[] = ["SELESAI", "DITOLAK", "KADALUARSA", "DIBATALKAN"];
const transitions: Record<RentalStatus, readonly RentalStatus[]> = {
  DIAJUKAN: ["DISETUJUI", "DITOLAK", "KADALUARSA", "DIBATALKAN"],
  DISETUJUI: ["MENUNGGU_VERIFIKASI", "KADALUARSA", "DIBATALKAN"],
  MENUNGGU_VERIFIKASI: ["DIBAYAR", "DISETUJUI", "DIBATALKAN"],
  DIBAYAR: ["BERJALAN", "DIBATALKAN", "SENGKETA"],
  BERJALAN: ["DIKEMBALIKAN", "SENGKETA"],
  DIKEMBALIKAN: ["PENCAIRAN_DIPROSES", "SENGKETA"],
  SENGKETA: ["PENCAIRAN_DIPROSES", "DIBATALKAN", "DIBAYAR", "BERJALAN"],
  PENCAIRAN_DIPROSES: ["SELESAI"],
  SELESAI: [],
  DITOLAK: [],
  KADALUARSA: [],
  DIBATALKAN: [],
};
export function canTransition(from: RentalStatus, to: RentalStatus) {
  return transitions[from].includes(to);
}
export const RENTAL_LABELS: Record<RentalStatus, string> = {
  DIAJUKAN: "Menunggu persetujuan",
  DISETUJUI: "Menunggu pembayaran",
  MENUNGGU_VERIFIKASI: "Menunggu verifikasi",
  DIBAYAR: "Siap serah terima",
  BERJALAN: "Sedang disewa",
  DIKEMBALIKAN: "Cek kondisi",
  SENGKETA: "Dalam mediasi",
  PENCAIRAN_DIPROSES: "Dana diproses",
  SELESAI: "Selesai",
  DITOLAK: "Ditolak",
  KADALUARSA: "Kedaluwarsa",
  DIBATALKAN: "Dibatalkan",
};
