// Browser-side compression. Re-encoding through canvas also drops EXIF/XMP metadata.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export function checkImageFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Pilih foto JPEG, PNG, atau WebP.");
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("Ukuran foto maksimal 5 MB. Pilih foto yang lebih kecil.");
}
export async function loadImage(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Foto tidak dapat diproses."))),
      type,
      quality,
    ),
  );
}
// Browsers without a WebP encoder silently return PNG, so fall back to JPEG instead.
export async function encodeImage(
  image: HTMLImageElement,
  maxSide: number,
  type: "image/jpeg" | "image/webp" = "image/jpeg",
  quality = 0.85,
) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak mendukung pemrosesan foto.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await toBlob(canvas, type, quality);
  return blob.type === type ? blob : toBlob(canvas, "image/jpeg", quality);
}
export async function compressImage(file: File, maxSide = 1600) {
  checkImageFile(file);
  return encodeImage(await loadImage(file), maxSide);
}
