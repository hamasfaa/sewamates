import { describe, expect, it } from "vitest";
import {
  cancellationFee,
  cancellationSplit,
  cancellationTerms,
  fullRefund,
  lateFee,
  normalSplit,
  payoutTarget,
  splitIsValid,
} from "@/src/domain/payout";
import {
  checkInOpen,
  codeLocked,
  failedCodeAttempt,
  noShowOpensAt,
  phaseOf,
  photographer,
} from "@/src/domain/handover";
import { commission, paymentTotals } from "@/src/domain/pricing";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";

const H = 3600000;
// A-3.8: Rp20.000/hari × 3 hari, deposit Rp100.000, kode unik 347.
const example = {
  rentTotal: 60000,
  pricePerDay: 20000,
  deposit: 100000,
  commissionRateBp: 1000,
  commissionAmount: commission(60000, 1000),
  dueAt: new Date("2026-11-03T03:00:00.000Z"),
};
const received = paymentTotals(60000, 100000, 347).amountDue;

describe("pembagian dana A-3.8", () => {
  it("contoh normal: pemilik 54.000, refund 100.347, komisi 6.000", () => {
    expect(received).toBe(160347);
    const split = normalSplit(example, received, 0);
    expect(split).toEqual({ owner: 54000, renter: 100347, commission: 6000 });
    expect(splitIsValid(split, received)).toBe(true);
  });
  it("contoh telat 30 jam: dua periode denda, tanpa komisi atas denda", () => {
    const fee = lateFee(example, new Date(example.dueAt.getTime() + 30 * H), DEFAULT_SETTINGS);
    expect(fee).toBe(20000);
    expect(normalSplit(example, received, fee)).toEqual({
      owner: 74000,
      renter: 80347,
      commission: 6000,
    });
  });
  it("denda nol dalam toleransi, mulai satu periode setelahnya, dan dibatasi deposit", () => {
    const at = (hours: number) => new Date(example.dueAt.getTime() + hours * H);
    expect(lateFee(example, at(2), DEFAULT_SETTINGS)).toBe(0);
    expect(lateFee(example, new Date(at(2).getTime() + 1), DEFAULT_SETTINGS)).toBe(10000);
    expect(lateFee(example, at(26), DEFAULT_SETTINGS)).toBe(10000);
    expect(lateFee(example, at(26.01), DEFAULT_SETTINGS)).toBe(20000);
    expect(lateFee(example, at(24 * 40), DEFAULT_SETTINGS)).toBe(100000);
    expect(lateFee(example, at(-5), DEFAULT_SETTINGS)).toBe(0);
  });
  it("denda dibulatkan setengah ke atas dari total", () => {
    expect(
      lateFee({ ...example, pricePerDay: 25001 }, new Date(example.dueAt.getTime() + 51 * H), {
        late_grace_hours: 2,
        late_rate_bp: 5000,
      }),
    ).toBe(Math.floor((3 * 25001 * 5000 + 5000) / 10000));
  });
  it("menolak pembagian yang tidak sama dengan dana diterima atau bernilai negatif", () => {
    expect(splitIsValid({ owner: 1, renter: 1, commission: 1 }, 3)).toBe(true);
    expect(splitIsValid({ owner: 1, renter: 1, commission: 1 }, 4)).toBe(false);
    expect(splitIsValid({ owner: -1, renter: 4, commission: 0 }, 3)).toBe(false);
    expect(splitIsValid({ owner: 0.5, renter: 2.5, commission: 0 }, 3)).toBe(false);
  });
});

describe("pembatalan A-3.6", () => {
  it("contoh biaya batal: pemilik 10.800, komisi 1.200, penyewa 148.347", () => {
    const split = cancellationSplit(example, received, DEFAULT_SETTINGS.cancellation_rate_bp);
    expect(split).toEqual({ owner: 10800, renter: 148347, commission: 1200, fee: 12000 });
    expect(splitIsValid(split, received)).toBe(true);
  });
  it("semua baris tabel memenuhi invarian pemilik + penyewa + komisi = dana diterima", () => {
    for (const amount of [1, 50000, 150001, received, 10_000_347]) {
      expect(splitIsValid(fullRefund(amount), amount)).toBe(true);
      if (amount >= example.rentTotal) {
        expect(splitIsValid(cancellationSplit(example, amount, 2000), amount)).toBe(true);
        expect(splitIsValid(normalSplit(example, amount, 0), amount)).toBe(true);
      }
    }
  });
  it("biaya batal hanya untuk penyewa kurang dari 24 jam; pemilik setelah dibayar kena strike", () => {
    const start = new Date("2026-11-10T03:00:00.000Z"),
      rules = DEFAULT_SETTINGS;
    const before = (hours: number) => new Date(start.getTime() - hours * H);
    expect(cancellationTerms("DIBAYAR", "renter", start, before(24), rules)).toEqual({
      fee: false,
      strike: false,
    });
    expect(cancellationTerms("DIBAYAR", "renter", start, before(23.9), rules)).toEqual({
      fee: true,
      strike: false,
    });
    expect(cancellationTerms("DIBAYAR", "owner", start, before(1), rules)).toEqual({
      fee: false,
      strike: true,
    });
    for (const status of ["DIAJUKAN", "DISETUJUI"])
      expect(cancellationTerms(status, "owner", start, before(1), rules)).toEqual({
        fee: false,
        strike: false,
      });
    expect(cancellationFee(55555, 2000)).toBe(11111);
  });
});

describe("target pencairan dan serah terima", () => {
  it("tugas sebelum 18.00 WIB selesai pukul 21.00; setelahnya besok pukul 12.00", () => {
    const wib = (value: string) => new Date(`${value}+07:00`);
    expect(payoutTarget(wib("2026-11-03T17:59:00"), DEFAULT_SETTINGS)).toEqual(
      wib("2026-11-03T21:00:00"),
    );
    expect(payoutTarget(wib("2026-11-03T18:00:00"), DEFAULT_SETTINGS)).toEqual(
      wib("2026-11-04T12:00:00"),
    );
    expect(payoutTarget(wib("2026-11-03T00:30:00"), DEFAULT_SETTINGS)).toEqual(
      wib("2026-11-03T21:00:00"),
    );
  });
  it("kode salah lima kali mengunci 15 menit lalu penghitung mulai lagi", () => {
    const now = new Date("2026-11-03T03:00:00.000Z");
    let attempts = 0;
    for (let i = 0; i < 4; i++) {
      const next = failedCodeAttempt(attempts, now);
      expect(next.codeLockedUntil).toBeNull();
      attempts = next.codeFailedAttempts;
    }
    const locked = failedCodeAttempt(attempts, now);
    expect(locked).toEqual({
      codeFailedAttempts: 0,
      codeLockedUntil: new Date(now.getTime() + 15 * 60000),
    });
    expect(codeLocked(locked, new Date(now.getTime() + 14 * 60000))).toBe(true);
    expect(codeLocked(locked, new Date(now.getTime() + 15 * 60000))).toBe(false);
  });
  it("tahap mengikuti status, kehadiran dibuka 60 menit sebelum jadwal, laporan 30 menit setelahnya", () => {
    const start = new Date("2026-11-03T03:00:00.000Z");
    expect(phaseOf("DIBAYAR")).toBe("start");
    expect(phaseOf("BERJALAN")).toBe("end");
    expect(phaseOf("DIKEMBALIKAN")).toBeNull();
    expect(photographer("start")).toBe("renter");
    expect(photographer("end")).toBe("owner");
    expect(checkInOpen("start", start, new Date(start.getTime() - 61 * 60000))).toBe(false);
    expect(checkInOpen("start", start, new Date(start.getTime() - 60 * 60000))).toBe(true);
    expect(checkInOpen("end", start, new Date(start.getTime() - 48 * H))).toBe(true);
    expect(noShowOpensAt(start, DEFAULT_SETTINGS)).toEqual(new Date(start.getTime() + 30 * 60000));
  });
});
