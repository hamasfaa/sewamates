"use client";
import { useState } from "react";
import Image from "next/image";
import { useClock, useLiveApi, type Wire } from "@/src/lib/live-api";
import { api, useApi } from "@/src/lib/client-api";
import type { paymentDetail, paymentQueue } from "@/src/services/payment-service";
import { dateWib, rupiah } from "@/src/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
type Detail = Wire<Awaited<ReturnType<typeof paymentDetail>>>;
export function AdminPayments({ actorId }: { actorId: string }) {
  const now = useClock();
  const query = useLiveApi<Wire<Awaited<ReturnType<typeof paymentQueue>>>>(
      "/api/admin/payments",
      5000,
    ),
    [selected, setSelected] = useState("");
  return (
    <>
      <h1 className="text-3xl">Verifikasi pembayaran</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Periksa bukti terlama terlebih dahulu. Nominal yang dicatat harus sesuai mutasi rekening
        platform.
      </p>
      {query.error && (
        <p className="notice notice-error mb-4" role="alert">
          {query.error}
        </p>
      )}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          {!query.data && !query.error && (
            <div className="skeleton h-48" role="status" aria-label="Memuat antrean pembayaran" />
          )}
          {query.data?.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Tidak ada bukti yang menunggu verifikasi.
            </p>
          )}
          <ul className="space-y-2">
            {query.data?.map((row) => (
              <li key={row.payment.id}>
                <button
                  className={`w-full rounded-xl border p-3 text-left ${selected === row.payment.id ? "border-primary bg-secondary" : "border-transparent hover:bg-background"}`}
                  onClick={() => setSelected(row.payment.id)}
                >
                  <p className="text-xs text-muted-foreground">{row.publicCode}</p>
                  <p className="mt-1 font-bold">{rupiah(row.payment.claimedAmount)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateWib(row.payment.createdAt)}
                  </p>
                  {Date.parse(row.payment.targetAt) < now && (
                    <p className="mt-2 text-xs font-bold text-destructive">
                      Lewat target verifikasi
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected ? (
          <PaymentReview
            key={selected}
            id={selected}
            actorId={actorId}
            complete={async () => {
              setSelected("");
              await query.refresh();
            }}
          />
        ) : (
          <Card className="flex min-h-64 items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">Pilih bukti transfer untuk diperiksa.</p>
          </Card>
        )}
      </div>
    </>
  );
}
function PaymentReview({
  id,
  actorId,
  complete,
}: {
  id: string;
  actorId: string;
  complete: () => Promise<void>;
}) {
  const query = useApi<Detail>(`/api/admin/payments/${id}`),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(decision: "diterima" | "ditolak") {
    if (!query.data) return;
    const { payment, rental } = query.data,
      verifiedAmount = Number(amount);
    if (
      decision === "diterima" &&
      (!checked || !Number.isSafeInteger(verifiedAmount) || verifiedAmount <= 0)
    ) {
      setError("Cocokkan dengan mutasi dan isi nominal yang benar-benar masuk.");
      return;
    }
    if (decision === "ditolak" && reason.trim().length < 5) {
      setError("Isi alasan penolakan minimal 5 karakter.");
      return;
    }
    if (
      !window.confirm(
        `${decision === "diterima" ? "Terima" : "Tolak"} bukti ${rental.publicCode}?\n${decision === "diterima" ? `Nominal masuk: ${rupiah(verifiedAmount)}\nRekening: ${payment.platformSnapshot.provider} ${payment.platformSnapshot.accountNo}` : `Alasan: ${reason}`}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/payments/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          version: rental.version,
          decision,
          ...(decision === "diterima" ? { verifiedAmount } : { reason: reason.trim() }),
        }),
      });
      await complete();
    } catch (error) {
      setError((error as Error).message);
      query.reload();
      setChecked(false);
    } finally {
      setBusy(false);
    }
  }
  if (query.error)
    return (
      <Card>
        <p className="notice notice-error" role="alert">
          {query.error}
        </p>
      </Card>
    );
  if (!query.data)
    return (
      <Card>
        <div className="skeleton h-96" role="status" aria-label="Memuat bukti transfer" />
      </Card>
    );
  const { payment: p, rental: r } = query.data,
    self = [r.ownerId, r.renterId].includes(actorId);
  return (
    <Card className="min-w-0">
      <h2 className="text-2xl">{r.publicCode}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{String(r.listingSnapshot.title)}</p>
      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-border p-4">
          <h3 className="text-lg">Bukti dan rekening tujuan</h3>
          {!p.proofPath.endsWith(".pdf") && (
            <Image
              src={query.data.proofUrl}
              unoptimized
              width={600}
              height={800}
              alt="Bukti transfer yang diajukan"
              className="mt-4 max-h-96 w-full rounded-xl object-contain"
            />
          )}
          <a
            className="mt-3 flex min-h-12 items-center rounded-xl bg-secondary p-3 font-bold text-primary"
            href={query.data.proofUrl}
            target="_blank"
            rel="noreferrer"
          >
            Buka bukti transfer ↗
          </a>
          <p className="mt-3 text-sm">
            Bukti tersimpan privat. Buka untuk membandingkan dengan mutasi rekening.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Rekening", `${p.platformSnapshot.provider} ${p.platformSnapshot.accountNo}`],
              ["Atas nama", String(p.platformSnapshot.accountName)],
              ["Nama pengirim", p.senderName],
              ["Waktu transfer", dateWib(p.transferredAt)],
              ["Nominal klaim", rupiah(p.claimedAmount)],
              ["Target verifikasi", dateWib(p.targetAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-bold break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <h3 className="text-lg">Pembanding tagihan</h3>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Total tagihan", rupiah(r.amountDue)],
              ["Kode unik", String(r.uniqueCode || 0).padStart(3, "0")],
              ["Sudah diterima", rupiah(r.amountReceived)],
              ["Sisa kekurangan", rupiah(Math.max(0, r.amountDue - r.amountReceived))],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt>{label}</dt>
                <dd className="tabular font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          {self ? (
            <p className="notice mt-5">
              Minta admin lain memverifikasi pembayaran transaksi milikmu.
            </p>
          ) : p.status !== "menunggu" ? (
            <p className="notice mt-5">Bukti sudah diproses. Muat ulang antrean.</p>
          ) : (
            <div className="form-stack mt-6">
              <div>
                <label className="field-label" htmlFor="verified-amount">
                  Nominal yang masuk di mutasi (Rp)
                </label>
                <Input
                  id="verified-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000000000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                Saya sudah mencocokkan rekening, kode transaksi, nominal, dan mutasi asli.
              </label>
              <div>
                <label className="field-label" htmlFor="payment-reject-reason">
                  Alasan penolakan
                </label>
                <textarea
                  id="payment-reject-reason"
                  className="input min-h-24"
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void decide("diterima")}>
                  Terima pembayaran
                </Button>
                <Button disabled={busy} variant="outline" onClick={() => void decide("ditolak")}>
                  Tolak bukti
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p className="notice notice-error mt-4" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
