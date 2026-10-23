"use client";
import { api } from "./client-api";

export type PrivatePurpose =
  | "payment_proof"
  | "chat_image"
  | "handover_photo"
  | "dispute_evidence"
  | "payout_proof"
  | "cash_proof";
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
// Mirrors the server rule: PDFs only for transfer proofs and dispute evidence.
const PDF_PURPOSES: PrivatePurpose[] = [
  "payment_proof",
  "dispute_evidence",
  "payout_proof",
  "cash_proof",
];
export const acceptFor = (purpose: PrivatePurpose) =>
  [...IMAGES, ...(PDF_PURPOSES.includes(purpose) ? ["application/pdf"] : [])].join(",");
export function validatePrivateFile(file: Blob, purpose: PrivatePurpose) {
  if (
    !acceptFor(purpose).split(",").includes(file.type) ||
    file.size === 0 ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Pilih file yang didukung dengan ukuran maksimal 5 MB.");
}
// Signed upload into the private evidence bucket; the returned path is claimed by the action.
export async function uploadPrivateFile(file: Blob, purpose: PrivatePurpose) {
  validatePrivateFile(file, purpose);
  const ticket = await api<{ path: string; signedUrl: string }>("/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify({ purpose, contentType: file.type, size: file.size }),
  });
  const uploaded = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error("Unggahan belum berhasil. Periksa koneksi lalu coba lagi.");
  return ticket.path;
}
