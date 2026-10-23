"use client";
import { RentalReviewForm } from "./trust-user";
import Link from "next/link";
import { useState, useRef } from "react";
import type { rentalList } from "@/src/services/rental-service";
import { useClock, useLiveApi, type Wire } from "@/src/lib/live-api";
import { api } from "@/src/lib/client-api";
import { uploadPrivateFile, validatePrivateFile } from "@/src/lib/private-upload";
import { cn, dateWib, rupiah } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { StatusChip } from "./ui/status-chip";
import { CostSummary } from "./cost-summary";
import {
  CopyButton,
  Countdown,
  RentalStatusChip,
  RentalStepper,
  RentalTimeline,
  type RentalDetail as Detail,
} from "./rental-ui";
import { HandoverPanel } from "./handover-panel";
import {
  CancelPanel,
  CheckPanel,
  DisputePanel,
  NoShowPanel,
  PayoutList,
  PhotoGallery,
  ProblemPanel,
  ReschedulePanel,
} from "./rental-actions";

export function TransactionsView({ selectedId }: { selectedId?: string }) {
  const now = useClock();
  const [role, setRole] = useState("renter"),
    [state, setState] = useState("aktif"),
    query = useLiveApi<Wire<Awaited<ReturnType<typeof rentalList>>>>(
      `/api/rentals?role=${role}&state=${state}`,
      5000,
    );
  return (
    <div className="page-container py-6 lg:py-10">
      <h1 className="text-3xl">Transaksi</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pantau pengajuan, pembayaran, dan jadwal sewamu.
      </p>
      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section
          className={cn("min-w-0", selectedId && "hidden lg:block")}
          aria-label="Daftar transaksi"
        >
          <div className="mb-3 flex gap-2">
            {[
              ["renter", "Menyewa"],
              ["owner", "Disewakan"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={role === value ? "default" : "outline"}
                onClick={() => setRole(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="field-label" htmlFor="rental-state">
            Status transaksi
          </label>
          <select
            id="rental-state"
            className="input mb-4"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="aktif">Aktif</option>
            <option value="selesai">Selesai</option>
            <option value="dibatalkan">Dibatalkan / kedaluwarsa</option>
          </select>
          {query.error && (
            <p className="notice notice-error" role="alert">
              {query.error}
            </p>
          )}
          {!query.data && !query.error && (
            <div className="skeleton h-56" role="status" aria-label="Memuat transaksi" />
          )}
          {query.data?.length === 0 && (
            <Card>
              <h2 className="text-lg">Belum ada transaksi</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Temukan barang dari teman kampus untuk mulai menyewa.
              </p>
              <Button asChild className="mt-4">
                <Link href="/cari">Cari barang</Link>
              </Button>
            </Card>
          )}
          <ul className="space-y-3">
            {query.data?.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/transaksi/${row.id}`}
                  className={cn(
                    "block rounded-2xl border bg-card p-4",
                    selectedId === row.id ? "border-primary" : "border-border",
                  )}
                >
                  <span className="text-xs text-muted-foreground">{row.publicCode}</span>
                  <h2 className="mt-1 text-base break-words">{String(row.title)}</h2>
                  <div className="mt-2">
                    <RentalStatusChip
                      status={row.status}
                      late={Boolean(
                        now && row.status === "BERJALAN" && Date.parse(row.dueAt) < now,
                      )}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{dateWib(row.startAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0" aria-label="Detail transaksi">
          {selectedId ? (
            <RentalPanel id={selectedId} />
          ) : (
            <Card className="hidden min-h-64 items-center justify-center lg:flex">
              <p className="text-muted-foreground">Pilih transaksi untuk melihat detail.</p>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
function PaymentForm({ data, complete }: { data: Detail; complete: () => Promise<void> }) {
  const [account, setAccount] = useState(""),
    [sender, setSender] = useState(""),
    [amount, setAmount] = useState(""),
    [time, setTime] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const chosen = data.accounts.find((a) => a.id === account);
  const fileInput = useRef<HTMLInputElement>(null);
  function chooseFile(files: File[]) {
    if (busy) return;
    try {
      if (files.length !== 1) throw new Error("Pilih satu bukti transfer untuk setiap unggahan.");
      validatePrivateFile(files[0], "payment_proof");
      setFile(files[0]);
      setError("");
    } catch (error) {
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setError((error as Error).message);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!file) throw new Error("Pilih bukti transfer terlebih dahulu.");
      const proofPath = await uploadPrivateFile(file, "payment_proof");
      await api(`/api/rentals/${data.rental.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          platformAccountId: account,
          proofPath,
          senderName: sender,
          claimedAmount: Number(amount),
          transferredAt: new Date(`${time}+07:00`).toISOString(),
        }),
      });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setAmount("");
      await complete();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">Unggah bukti transfer</h3>
      <p className="mt-2 mb-5 text-sm text-muted-foreground">
        Transfer ke rekening platform, lalu unggah bukti. Admin mencocokkan dengan mutasi rekening.
        {` Jam operasional admin ${data.rental.rulesSnapshot.admin_open_hour}.00–${data.rental.rulesSnapshot.admin_close_hour}.00 WIB.`}
      </p>
      <form className="form-stack" onSubmit={submit}>
        <div>
          <label className="field-label" htmlFor="payment-account">
            Rekening tujuan
          </label>
          <select
            id="payment-account"
            className="input"
            required
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Pilih rekening platform</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.provider} · {a.accountNo} · {a.accountName}
              </option>
            ))}
          </select>
          {chosen && (
            <div className="notice mt-3">
              <p className="break-all font-bold">
                {chosen.provider} · {chosen.accountNo}
              </p>
              <p className="mb-2 text-sm">a.n. {chosen.accountName}</p>
              <CopyButton value={chosen.accountNo} label="Salin nomor" />
            </div>
          )}
          {!data.accounts.length && (
            <p className="notice mt-3">Rekening platform belum tersedia. Hubungi admin.</p>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="payment-sender">
            Nama pengirim
          </label>
          <Input
            id="payment-sender"
            minLength={2}
            maxLength={100}
            required
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="payment-amount">
            Nominal yang ditransfer (Rp)
          </label>
          <Input
            id="payment-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000000000}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="payment-time">
            Waktu transfer (WIB)
          </label>
          <Input
            id="payment-time"
            type="datetime-local"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div
          role="group"
          aria-label="Area unggah bukti transfer"
          className={cn(
            "rounded-xl border-2 border-dashed p-4 transition-colors",
            dragging ? "border-primary bg-secondary" : "border-border",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = busy ? "none" : "copy";
            if (!busy) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(Array.from(event.dataTransfer.files));
          }}
        >
          <label className="field-label" htmlFor="payment-file">
            Bukti transfer
          </label>
          <Input
            id="payment-file"
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required={!file}
            disabled={busy}
            aria-describedby="payment-file-help"
            onChange={(event) => {
              if (event.target.files?.length) chooseFile(Array.from(event.target.files));
            }}
          />
          <p id="payment-file-help" className="help">
            Tarik satu file ke area ini atau pilih dari perangkat. JPEG, PNG, WebP, atau PDF;
            maksimal 5 MB.
          </p>
          {file && (
            <p className="mt-2 text-sm break-all" role="status">
              File dipilih: <strong>{file.name}</strong>
            </p>
          )}
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !data.accounts.length}>
          {busy ? "Mengunggah…" : "Kirim bukti transfer"}
        </Button>
      </form>
    </Card>
  );
}
function PaymentSummary({ data, sticky }: { data: Detail; sticky: boolean }) {
  const r = data.rental;
  return (
    <Card className={cn("min-w-0", sticky && "lg:sticky lg:top-24 lg:order-last lg:self-start")}>
      <h3 className="mb-5 text-xl">Rincian pembayaran</h3>
      <CostSummary
        pricePerDay={r.pricePerDay}
        days={r.days}
        deposit={r.deposit}
        uniqueCode={r.uniqueCode ?? undefined}
      />
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm">
          Sudah diterima: <strong>{rupiah(r.amountReceived)}</strong>
        </p>
        {data.totals.remaining > 0 && (
          <p className="mt-2 text-lg font-bold">Kurang {rupiah(data.totals.remaining)}</p>
        )}
        {data.totals.overpayment > 0 && (
          <p className="help">
            Kelebihan {rupiah(data.totals.overpayment)} ikut dikembalikan bersama deposit.
          </p>
        )}
      </div>
      {r.uniqueCode !== null && (
        <div className="notice mt-4">
          <p>
            Kode unik:{" "}
            <strong className="tabular text-xl">{String(r.uniqueCode).padStart(3, "0")}</strong>
          </p>
          <div className="mt-2">
            <CopyButton value={String(r.amountDue)} label="Salin total tagihan" />
          </div>
          <p className="help">Tulis {r.publicCode} di berita transfer jika tersedia.</p>
        </div>
      )}
    </Card>
  );
}
function RentalPanel({ id }: { id: string }) {
  const now = useClock();
  const query = useLiveApi<Detail>(`/api/rentals/${id}`, 5000),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function act(action: "approve" | "reject") {
    if (!query.data) return;
    if (
      !window.confirm(
        `${action === "approve" ? "Setujui" : "Tolak"} transaksi ${query.data.rental.publicCode}?`,
      )
    )
      return;
    setBusy(action);
    setError("");
    try {
      await api(`/api/rentals/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({
          version: query.data.rental.version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      await query.refresh();
    } catch (error) {
      setError((error as Error).message);
      await query.refresh();
    } finally {
      setBusy("");
    }
  }
  if (!query.data)
    return query.error ? (
      <p className="notice notice-error" role="alert">
        {query.error}
      </p>
    ) : (
      <div className="skeleton h-96" role="status" aria-label="Memuat detail transaksi" />
    );
  const data = query.data,
    r = data.rental,
    owner = data.viewer.isOwner,
    renter = data.viewer.isRenter,
    refresh = query.refresh;
  const pending = data.payments.filter((p) => p.status === "menunggu"),
    canUpload =
      renter &&
      ["DISETUJUI", "MENUNGGU_VERIFIKASI"].includes(r.status) &&
      r.payBy &&
      Date.parse(r.payBy) > now,
    late = Boolean(now && r.status === "BERJALAN" && Date.parse(r.dueAt) < now),
    refunded = data.payouts.length > 0 && data.payouts.every((task) => task.status === "selesai");
  return (
    <div className="space-y-5">
      <Link className="text-sm font-bold text-primary lg:hidden" href="/transaksi">
        ← Daftar transaksi
      </Link>
      <Card className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{r.publicCode}</p>
            <h2 className="mt-1 text-2xl break-words">{String(r.listingSnapshot.title)}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <RentalStatusChip status={r.status} late={late} />
            {["KADALUARSA", "DIBATALKAN", "DITOLAK"].includes(r.status) &&
              data.payouts.length > 0 && (
                <StatusChip tone={refunded ? "success" : "warning"}>
                  {refunded ? "Refund selesai" : "Refund diproses"}
                </StatusChip>
              )}
          </div>
        </div>
        <RentalStepper status={r.status} before={r.statusBeforeDispute} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CopyButton value={r.publicCode} label="Salin kode transaksi" />
          <Button asChild size="sm" variant="outline">
            <Link href={`/chat/${r.conversationId}`}>Buka chat</Link>
          </Button>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          {[
            ["Mulai", dateWib(r.startAt)],
            ["Jatuh tempo", dateWib(r.dueAt)],
            ["Titik", (r.listingSnapshot.point as { name?: string })?.name],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-bold break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {data.people.map((person) => (
            <div key={person.id} className="min-w-0 rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {person.id === r.ownerId ? "Pemilik" : "Penyewa"}
              </p>
              <Link
                href={`/pengguna/${person.id}`}
                className="mt-1 block font-bold text-primary break-words"
              >
                {person.name}
              </Link>
              <p className="mt-2 text-xs">
                {person.verificationStatus === "terverifikasi"
                  ? "Identitas terverifikasi"
                  : "Identitas belum terverifikasi"}{" "}
                · {person.completedCount} transaksi selesai
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {person.ratingCount
                  ? `Rating ${(person.ratingAvg / 100).toFixed(1)} (${person.ratingCount})`
                  : "Belum ada rating"}
              </p>
            </div>
          ))}
        </div>
        {["KADALUARSA", "DIBATALKAN", "DITOLAK"].includes(r.status) && r.amountReceived > 0 && (
          <p className="notice mt-4">
            Dana masuk {rupiah(r.amountReceived)} dibagi sesuai aturan pembatalan dan ditransfer
            admin ke rekening/e-wallet terdaftar. Status transfer ada di bagian Pencairan &amp;
            refund.
          </p>
        )}
        {r.status === "DIAJUKAN" && <Countdown target={r.respondBy} label="Batas tanggapan" />}
        {r.status === "DISETUJUI" && r.payBy && (
          <Countdown target={r.payBy} label="Batas unggah bukti" />
        )}
        {pending[0] && <Countdown target={pending[0].targetAt} label="Target verifikasi admin" />}
        {r.status === "DIBAYAR" && (
          <p className="notice mt-5">
            Pembayaran sudah diterima platform. Siapkan serah terima sesuai jadwal.
          </p>
        )}
        {r.status === "BERJALAN" &&
          (late ? (
            <p className="notice notice-error mt-5" role="status">
              Sudah lewat jatuh tempo. Denda {r.rulesSnapshot.late_rate_bp / 100}% harga per hari
              berlaku untuk setiap 24 jam setelah toleransi {r.rulesSnapshot.late_grace_hours} jam.
            </p>
          ) : (
            <Countdown target={r.dueAt} label="Batas pengembalian" />
          ))}
        {r.status === "PENCAIRAN_DIPROSES" && (
          <p className="notice mt-5">
            Pengembalian selesai. Admin sedang mentransfer pencairan dan refund; bukti transfer
            muncul di bagian Pencairan &amp; refund.
          </p>
        )}
        {r.status === "SENGKETA" && (
          <p className="notice notice-error mt-5">
            Transaksi dalam mediasi admin. Dana tetap ditahan sampai ada putusan.
          </p>
        )}
        {r.status === "MENUNGGU_VERIFIKASI" && (
          <p className="notice mt-5">
            Bukti sedang diperiksa admin. Pembatalan tersedia setelah status pembayaran jelas. Jam
            operasional admin {String(r.rulesSnapshot.admin_open_hour).padStart(2, "0")}.00–
            {String(r.rulesSnapshot.admin_close_hour).padStart(2, "0")}.00 WIB.
          </p>
        )}
        {owner && r.status === "DIAJUKAN" && (
          <div className="mt-5 border-t border-border pt-5">
            <label className="field-label" htmlFor="decision-reason">
              Catatan / alasan (opsional)
            </label>
            <Input
              id="decision-reason"
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={!!busy || !data.canApprove} onClick={() => void act("approve")}>
                Terima pengajuan
              </Button>
              <Button variant="outline" disabled={!!busy} onClick={() => void act("reject")}>
                Tolak pengajuan
              </Button>
              {!data.canApprove && (
                <p className="help w-full">
                  Persetujuan tidak tersedia karena jadwal berbenturan atau batas tanggapan
                  berakhir.
                </p>
              )}
            </div>
          </div>
        )}
        {data.actions.canCancel && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
            <CancelPanel data={data} refresh={refresh} />
          </div>
        )}
        {(error || query.error) && (
          <p className="notice notice-error mt-4" role="alert">
            {error || query.error}
          </p>
        )}
      </Card>
      {(owner || renter) && (
        <>
          <NoShowPanel data={data} refresh={refresh} />
          {data.actions.phase && <HandoverPanel data={data} refresh={refresh} />}
          <CheckPanel data={data} refresh={refresh} />
          <ProblemPanel data={data} refresh={refresh} />
          <ReschedulePanel data={data} refresh={refresh} />
        </>
      )}
      <DisputePanel data={data} refresh={refresh} />
      <section
        aria-label="Pembayaran"
        className={cn(
          "grid min-w-0 gap-5",
          canUpload && "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]",
        )}
      >
        <PaymentSummary data={data} sticky={Boolean(canUpload)} />
        {canUpload && <PaymentForm data={data} complete={query.refresh} />}
      </section>
      {data.payments.length > 0 && (
        <Card className="min-w-0">
          <h3 className="text-xl">Bukti pembayaran</h3>
          <ul className="mt-4 divide-y divide-border">
            {data.payments.map((p) => (
              <li key={p.id} className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{rupiah(p.claimedAmount)}</strong>
                  <StatusChip
                    tone={
                      p.status === "diterima"
                        ? "success"
                        : p.status === "ditolak"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {p.status}
                  </StatusChip>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {p.senderName} · {dateWib(p.transferredAt)}
                </p>
                {p.verifiedAmount !== null && (
                  <p className="mt-1">Diterima platform: {rupiah(p.verifiedAmount)}</p>
                )}
                {p.rejectReason && <p className="mt-1 text-destructive">{p.rejectReason}</p>}
                <a
                  className="mt-2 inline-flex min-h-11 items-center font-bold text-primary"
                  href={p.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Lihat bukti transfer ↗
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <PhotoGallery data={data} />
      <PayoutList data={data} />
      {(owner || renter) && <RentalReviewForm id={r.id} />}
      <Card className="min-w-0">
        <h3 className="text-xl">Riwayat transaksi</h3>
        <RentalTimeline data={data} />
      </Card>
    </div>
  );
}
