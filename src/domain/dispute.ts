// Dispute categories from A-3.10.
export const DISPUTE_CATEGORIES = [
  "rusak",
  "hilang",
  "telat",
  "tidak_sesuai",
  "tidak_hadir",
  "lainnya",
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
export const DISPUTE_LABELS: Record<DisputeCategory, string> = {
  rusak: "Barang rusak",
  hilang: "Barang hilang / tidak dikembalikan",
  telat: "Keterlambatan",
  tidak_sesuai: "Barang tidak sesuai",
  tidak_hadir: "Tidak hadir",
  lainnya: "Masalah lain",
};
// tidak_hadir only comes from contesting a no-show report or from the system.
export const USER_DISPUTE_CATEGORIES = DISPUTE_CATEGORIES.filter(
  (category) => category !== "tidak_hadir",
);
