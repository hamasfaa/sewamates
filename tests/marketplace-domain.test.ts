import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";
import { commission, depositAllowed, depositRange, netEstimate } from "@/src/domain/pricing";
import { needsReview, ownerTransition, statusAfterEdit } from "@/src/domain/listing";
import { DEFAULT_HOURS, hoursSchema, summarizeHours } from "@/src/domain/pickup-points";
import {
  blockedDays,
  monthDays,
  periodDates,
  shiftMonth,
  wibDateKey,
  wibDayRange,
} from "@/src/domain/availability";
import { defaultSort, prefixQuery, searchTerms } from "@/src/domain/search";
import { hasEmbeddedMetadata } from "@/src/lib/storage";
import { itemInput, searchInput } from "@/src/lib/validation";
import { rupiah } from "@/src/lib/utils";

const rules = DEFAULT_SETTINGS;
describe("Deposit dan komisi (A-3.2, A-3.8)", () => {
  it("menerapkan rentang 10–50% dengan batas atas Rp1.000.000", () => {
    expect(depositRange(20_000_000, rules)).toEqual({ min: 1_000_000, max: 1_000_000 });
    expect(depositRange(100_000, rules)).toEqual({ min: 10_000, max: 50_000 });
    expect(depositRange(2_500_000, rules)).toEqual({ min: 250_000, max: 1_000_000 });
    expect(depositRange(10_000_000, rules)).toEqual({ min: 1_000_000, max: 1_000_000 });
  });
  it("membulatkan batas ke dalam per Rp1.000 agar persentase tidak terlampaui", () => {
    expect(depositRange(15_500, rules)).toEqual({ min: 2_000, max: 7_000 });
    expect(depositAllowed(7_000, 15_500, rules)).toBe(true);
    expect(depositAllowed(8_000, 15_500, rules)).toBe(false);
    expect(depositAllowed(1_500, 15_500, rules)).toBe(false);
    expect(depositAllowed(2_500, 15_500, rules)).toBe(false);
  });
  it("tidak pernah mengizinkan deposit nol dan mengikuti settings yang diubah", () => {
    expect(depositRange(1_500, rules).min).toBe(1_000);
    expect(depositRange(1_500, rules).max).toBeLessThan(depositRange(1_500, rules).min);
    expect(
      depositRange(1_000_000, { deposit_min_bp: 2000, deposit_max_bp: 3000, deposit_cap: 250_000 }),
    ).toEqual({ min: 200_000, max: 250_000 });
  });
  it("menghitung komisi 10% dibulatkan setengah ke atas dan contoh pendapatan bersih A-3.8", () => {
    expect(commission(60_000, 1000)).toBe(6_000);
    expect(commission(12_345, 1000)).toBe(1_235);
    expect(commission(12_344, 1000)).toBe(1_234);
    expect(netEstimate(20_000, 3, rules.commission_rate_bp)).toBe(54_000);
  });
  it("memformat nominal seperti Rp160.347", () => {
    expect(rupiah(160_347)).toBe("Rp160.347");
    expect(rupiah(1_000_000)).toBe("Rp1.000.000");
  });
});

describe("Status listing (A-3.2)", () => {
  it("hanya mengizinkan jeda dari aktif, aktifkan dari dijeda, dan arsip satu arah", () => {
    expect(ownerTransition("aktif", "pause")).toBe("dijeda");
    expect(ownerTransition("dijeda", "resume")).toBe("aktif");
    expect(ownerTransition("menunggu_review", "pause")).toBeNull();
    expect(ownerTransition("ditolak", "resume")).toBeNull();
    for (const status of ["menunggu_review", "aktif", "ditolak", "dijeda"] as const)
      expect(ownerTransition(status, "archive")).toBe("diarsipkan");
    expect(ownerTransition("diarsipkan", "archive")).toBeNull();
    expect(ownerTransition("diarsipkan", "resume")).toBeNull();
  });
  it("meninjau ulang perubahan judul, kategori, atau kumpulan foto, tetapi tidak urutan foto", () => {
    const base = { title: "Kamera Canon", categoryId: "a", photoPaths: ["1", "2", "3"] };
    expect(needsReview(base, { ...base, title: " Kamera Canon " })).toBe(false);
    expect(needsReview(base, { ...base, photoPaths: ["3", "1", "2"] })).toBe(false);
    expect(needsReview(base, { ...base, title: "Kamera Sony" })).toBe(true);
    expect(needsReview(base, { ...base, categoryId: "b" })).toBe(true);
    expect(needsReview(base, { ...base, photoPaths: ["1", "2", "4"] })).toBe(true);
    expect(needsReview(base, { ...base, photoPaths: ["1", "2"] })).toBe(true);
  });
  it("menentukan status setelah diubah pemilik", () => {
    expect(statusAfterEdit("aktif", false)).toBe("aktif");
    expect(statusAfterEdit("dijeda", false)).toBe("dijeda");
    expect(statusAfterEdit("aktif", true)).toBe("menunggu_review");
    expect(statusAfterEdit("ditolak", false)).toBe("menunggu_review");
    expect(statusAfterEdit("menunggu_review", false)).toBe("menunggu_review");
    expect(statusAfterEdit("diarsipkan", false)).toBeNull();
  });
});

describe("Jam titik serah terima", () => {
  it("meringkas hari berurutan dengan jam yang sama", () => {
    expect(summarizeHours(DEFAULT_HOURS)).toEqual(["Sen–Jum 08.00–17.00", "Sab 08.00–12.00"]);
    expect(
      summarizeHours([null, { open: "09:00", close: "10:00" }, null, null, null, null, null]),
    ).toEqual(["Sel 09.00–10.00"]);
  });
  it("menolak jam terbalik, format salah, panjang salah, dan semua hari tutup", () => {
    expect(hoursSchema.safeParse(DEFAULT_HOURS).success).toBe(true);
    const closed = Array(7).fill(null);
    expect(hoursSchema.safeParse(closed).success).toBe(false);
    expect(hoursSchema.safeParse(DEFAULT_HOURS.slice(0, 6)).success).toBe(false);
    expect(
      hoursSchema.safeParse([{ open: "17:00", close: "08:00" }, ...closed.slice(1)]).success,
    ).toBe(false);
    expect(
      hoursSchema.safeParse([{ open: "8:00", close: "17:00" }, ...closed.slice(1)]).success,
    ).toBe(false);
  });
});

describe("Tanggal WIB dan ketersediaan", () => {
  it("memetakan tanggal kalender WIB ke rentang UTC [mulai, akhir)", () => {
    const range = wibDayRange("2026-10-21", "2026-10-22");
    expect(range.start.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-22T17:00:00.000Z");
    expect(periodDates(range)).toEqual({ from: "2026-10-21", to: "2026-10-22" });
    expect(wibDateKey(new Date("2026-10-21T16:59:59.999Z"))).toBe("2026-10-21");
    expect(wibDateKey(new Date("2026-10-21T17:00:00.000Z"))).toBe("2026-10-22");
  });
  it("menandai hari yang tersentuh blokir di bulan tertentu, termasuk lintas bulan", () => {
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    const block = wibDayRange("2026-10-30", "2026-11-02");
    expect(blockedDays([block], "2026-10")).toEqual(["2026-10-30", "2026-10-31"]);
    expect(blockedDays([block], "2026-11")).toEqual(["2026-11-01", "2026-11-02"]);
    const partial = {
      start: new Date("2026-11-05T03:00:00.000Z"),
      end: new Date("2026-11-05T05:00:00.000Z"),
    };
    expect(blockedDays([partial], "2026-11")).toEqual(["2026-11-05"]);
  });
});

describe("Pencarian dan input", () => {
  it("hanya meneruskan huruf dan angka ke tsquery", () => {
    expect(searchTerms("Kamera  CANON, eos-1200D!")).toEqual(["kamera", "canon", "eos", "1200d"]);
    expect(searchTerms("a & b | !c :* ' ( )")).toEqual(["a", "b", "c"]);
    expect(searchTerms("kamera kamera")).toEqual(["kamera"]);
    expect(searchTerms("x ".repeat(20) + "1 2 3 4 5 6 7 8 9")).toHaveLength(8);
    expect(prefixQuery(["kame", "canon"])).toBe("kame:* & canon:*");
    expect(defaultSort("  ")).toBe("terbaru");
    expect(defaultSort("tenda")).toBe("relevan");
  });
  it("memvalidasi filter pencarian dan mengabaikan parameter asing", () => {
    expect(searchInput.parse({ q: "", min: "1000", utm_source: "ig" })).toEqual({ min: 1000 });
    expect(searchInput.safeParse({ min: "5000", max: "1000" }).success).toBe(false);
    expect(searchInput.safeParse({ from: "2026-10-01", to: "2027-02-01" }).success).toBe(false);
    expect(searchInput.safeParse({ sort: "acak" }).success).toBe(false);
    expect(searchInput.safeParse({ campus: "bukan-uuid" }).success).toBe(false);
  });
  it("memvalidasi listing sesuai batas A-3.2", () => {
    const photo = (n: number) => ({ path: `p${n}`, thumbPath: `t${n}` });
    const valid = {
      title: "Kamera Canon EOS",
      categoryId: crypto.randomUUID(),
      description: "Kondisi mulus, lengkap dengan charger dan tas.",
      itemValue: 3_000_000,
      pricePerDay: 50_000,
      deposit: 300_000,
      minDays: 1,
      maxDays: 7,
      pickupPointIds: [crypto.randomUUID()],
      photos: [photo(1), photo(2), photo(3)],
    };
    expect(itemInput.safeParse(valid).success).toBe(true);
    for (const patch of [
      { photos: [photo(1), photo(2)] },
      { photos: Array.from({ length: 9 }, (_, n) => photo(n)) },
      { photos: [photo(1), photo(1), photo(2)] },
      { deposit: 300_500 },
      { deposit: 0 },
      { minDays: 5, maxDays: 2 },
      { pickupPointIds: [] },
      { itemValue: 5_000 },
      { pricePerDay: 1_500.5 },
      { title: "Kam" },
      { description: "Pendek" },
      { extra: true },
    ])
      expect(itemInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("Metadata foto publik", () => {
  const jpeg = (segments: number[][]) =>
    new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2]);
  const segment = (marker: number, payload: number[]) => [
    0xff,
    marker,
    0,
    payload.length + 2,
    ...payload,
  ];
  const chunk = (type: string, size: number) => [
    ...Buffer.from(type, "latin1"),
    size,
    0,
    0,
    0,
    ...Array(size).fill(0),
  ];
  it("menolak JPEG dengan APP1 (Exif/XMP) dan menerima JFIF dari canvas", () => {
    expect(hasEmbeddedMetadata(jpeg([segment(0xe0, [74, 70, 73, 70, 0])]))).toBe(false);
    expect(hasEmbeddedMetadata(jpeg([segment(0xe1, [69, 120, 105, 102, 0, 0])]))).toBe(true);
  });
  it("menolak chunk EXIF/XMP pada WebP dan teks pada PNG", () => {
    const webp = (chunks: number[][]) =>
      new Uint8Array([
        ...Buffer.from("RIFF"),
        0,
        0,
        0,
        0,
        ...Buffer.from("WEBP"),
        ...chunks.flat(),
      ]);
    expect(hasEmbeddedMetadata(webp([chunk("VP8 ", 4)]))).toBe(false);
    expect(hasEmbeddedMetadata(webp([chunk("VP8X", 10), chunk("EXIF", 6)]))).toBe(true);
    const png = (type: string) =>
      new Uint8Array([
        0x89,
        ...Buffer.from("PNG\r\n\x1a\n", "latin1"),
        0,
        0,
        0,
        0,
        ...Buffer.from(type, "latin1"),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        ...Buffer.from("IEND", "latin1"),
      ]);
    expect(hasEmbeddedMetadata(png("IDAT"))).toBe(false);
    expect(hasEmbeddedMetadata(png("tEXt"))).toBe(true);
  });
});
