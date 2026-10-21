// Listing rules from A-3.2. Status changes outside these functions are rejected by services.
export const ITEM_STATUSES = [
  "menunggu_review",
  "aktif",
  "ditolak",
  "dijeda",
  "diarsipkan",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const LISTING_LIMITS = {
  photos: { min: 3, max: 8 },
  title: { min: 5, max: 80 },
  description: { min: 20, max: 2000 },
  itemValue: { min: 10_000, max: 100_000_000 },
  pricePerDay: { min: 1_000, max: 10_000_000 },
  days: { min: 1, max: 90 },
  pickupPoints: { min: 1, max: 10 },
} as const;

export type OwnerAction = "pause" | "resume" | "archive";
const allowedFrom: Record<OwnerAction, readonly ItemStatus[]> = {
  pause: ["aktif"],
  resume: ["dijeda"],
  archive: ["menunggu_review", "aktif", "ditolak", "dijeda"],
};
const targets: Record<OwnerAction, ItemStatus> = {
  pause: "dijeda",
  resume: "aktif",
  archive: "diarsipkan",
};
export function ownerTransition(status: ItemStatus, action: OwnerAction): ItemStatus | null {
  return allowedFrom[action].includes(status) ? targets[action] : null;
}

type ReviewedContent = { title: string; categoryId: string; photoPaths: string[] };
// Title, category, or the set of photos need a new review; reordering alone does not.
export function needsReview(before: ReviewedContent, after: ReviewedContent) {
  const photos = (paths: string[]) => [...paths].sort().join("\n");
  return (
    before.title.trim() !== after.title.trim() ||
    before.categoryId !== after.categoryId ||
    photos(before.photoPaths) !== photos(after.photoPaths)
  );
}
// A rejected listing is resubmitted by any edit; archived listings are read-only.
export function statusAfterEdit(status: ItemStatus, reviewNeeded: boolean): ItemStatus | null {
  if (status === "diarsipkan") return null;
  if (status === "ditolak" || status === "menunggu_review") return "menunggu_review";
  return reviewNeeded ? "menunggu_review" : status;
}
