"use client";
import { useId, useState } from "react";
import Image from "next/image";
import { api } from "@/src/lib/client-api";
import { acceptFor, uploadPrivateFile } from "@/src/lib/private-upload";
import { DISPUTE_LABELS, type DisputeCategory } from "@/src/domain/dispute";
import { dateWib, rupiah } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { StatusChip } from "./ui/status-chip";
import { Countdown, type RentalDetail } from "./rental-ui";

type Props = { data: RentalDetail; refresh: () => Promise<void> };
function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (error) {
      setError((error as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <p className="notice notice-error mt-3" role="alert">
      {error}
    </p>
  ) : null;
}
const post = (url: string, body: unknown) =>
  api(url, { method: "POST", body: JSON.stringify(body) });
const myId = (data: RentalDetail) =>
  data.viewer.isOwner ? data.rental.ownerId : data.rental.renterId;
async function uploadAll(files: File[], onProgress: (text: string) => void) {
  const paths: string[] = [];
  for (const [index, file] of files.entries()) {
    onProgress(`Mengunggah ${index + 1}/${files.length}…`);
    paths.push(await uploadPrivateFile(file, "dispute_evidence"));
  }
  return paths;
}
function EvidenceInput({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        Bukti (opsional, maksimal 10 file)
      </label>
      <Input
        id={id}
        type="file"
        multiple
        accept={acceptFor("dispute_evidence")}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <p id={`${id}-help`} className="help">
        Foto JPEG/PNG/WebP atau PDF, maksimal 5 MB per file.
        {files.length > 0 && ` ${files.length} file dipilih.`}
      </p>
    </div>
  );
}
// One form for "Barang tidak sesuai", "Lapor masalah", "Ada masalah", and no-show rebuttals (F13).
export function DisputeForm({
  categories,
  label,
  submit,
  onCancel,
}: {
  categories: DisputeCategory[];
  label: string;
  submit: (input: {
    category: DisputeCategory;
    description: string;
    evidencePaths: string[];
  }) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const id = useId(),
    [category, setCategory] = useState(categories[0]),
    [description, setDescription] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [progress, setProgress] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (description.trim().length < 20) return setError("Jelaskan masalahnya minimal 20 karakter.");
    if (files.length > 10) return setError("Pilih maksimal 10 file bukti.");
    setBusy(true);
    try {
      const evidencePaths = await uploadAll(files, setProgress);
      await submit({ category, description: description.trim(), evidencePaths });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <form className="form-stack mt-4" onSubmit={send}>
      {categories.length > 1 ? (
        <div>
          <label className="field-label" htmlFor={`${id}-category`}>
            Jenis masalah
          </label>
          <select
            id={`${id}-category`}
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value as DisputeCategory)}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {DISPUTE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm">
          Jenis masalah: <strong>{DISPUTE_LABELS[categories[0]]}</strong>
        </p>
      )}
      <div>
        <label className="field-label" htmlFor={`${id}-description`}>
          Jelaskan masalahnya
        </label>
        <textarea
          id={`${id}-description`}
          className="input min-h-28"
          minLength={20}
          maxLength={2000}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className="help">Minimal 20 karakter. Admin membaca ini bersama foto dan chat.</p>
      </div>
      <EvidenceInput files={files} onChange={setFiles} />
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? progress || "Mengirim…" : label}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Batal
          </Button>
        )}
      </div>
    </form>
  );
}
// Report a problem while the item is out, or "Barang tidak sesuai" at the handover (A-3.10).
export function ProblemPanel({ data, refresh }: Props) {
  const r = data.rental,
    [open, setOpen] = useState(false);
  if (!data.actions.canDispute || r.status === "DIKEMBALIKAN") return null;
  const atHandover = r.status === "DIBAYAR";
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">{atHandover ? "Barang tidak sesuai?" : "Ada masalah?"}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {atHandover
          ? "Jika barang berbeda dari listing, jangan konfirmasi kode. Laporkan agar admin memediasi; dana tetap ditahan."
          : "Laporkan kerusakan, kehilangan, atau masalah lain. Transaksi masuk mediasi admin dan dana tetap ditahan."}
      </p>
      {open ? (
        <DisputeForm
          categories={data.actions.disputeCategories}
          label={atHandover ? "Laporkan barang tidak sesuai" : "Kirim laporan masalah"}
          onCancel={() => setOpen(false)}
          submit={async (input) => {
            await post(`/api/rentals/${r.id}/disputes`, input);
            await refresh();
          }}
        />
      ) : (
        <Button className="mt-4" variant="outline" onClick={() => setOpen(true)}>
          {atHandover ? "Barang tidak sesuai" : "Laporkan masalah"}
        </Button>
      )}
    </Card>
  );
}
// Check window (A-3.5): payout preview with the automatic late fee, "Sesuai" or "Ada masalah".
export function CheckPanel({ data, refresh }: Props) {
  const r = data.rental,
    preview = data.preview,
    action = useAction(refresh),
    [problem, setProblem] = useState(false);
  if (r.status !== "DIKEMBALIKAN" || !preview) return null;
  const mine = data.viewer.isOwner ? r.ownerOkAt : r.renterOkAt,
    theirs = data.viewer.isOwner ? r.renterOkAt : r.ownerOkAt;
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">Cek kondisi barang</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Pilih &quot;Sesuai&quot; bila tidak ada masalah. Tanpa laporan sampai batas waktu,
        pengembalian dianggap sesuai dan dana dicairkan.
      </p>
      {r.reviewEndsAt && <Countdown target={r.reviewEndsAt} label="Batas masa cek" />}
      <h4 className="mt-5 text-base font-bold">Rincian pencairan yang akan dibuat</h4>
      <dl className="mt-3 space-y-2 text-sm">
        {[
          ["Ke pemilik (sewa − komisi + denda)", preview.owner],
          ["Refund ke penyewa", preview.renter],
          ["Komisi platform", preview.commission],
          ["Denda telat (dipotong dari deposit)", preview.lateFee],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular font-bold">{rupiah(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {mine && <p className="notice notice-success mt-4">Kamu sudah menyatakan kondisi sesuai.</p>}
      {theirs && <p className="mt-3 text-sm">Pihak lain sudah menyatakan kondisi sesuai.</p>}
      {problem ? (
        <DisputeForm
          categories={data.actions.disputeCategories}
          label="Kirim laporan masalah"
          onCancel={() => setProblem(false)}
          submit={async (input) => {
            await post(`/api/rentals/${r.id}/check`, { decision: "masalah", ...input });
            await refresh();
          }}
        />
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          {data.actions.canCheck && (
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(() => post(`/api/rentals/${r.id}/check`, { decision: "sesuai" }))
              }
            >
              Sesuai
            </Button>
          )}
          {data.actions.canDispute && (
            <Button variant="outline" disabled={action.busy} onClick={() => setProblem(true)}>
              Ada masalah
            </Button>
          )}
        </div>
      )}
      <ErrorNote error={action.error} />
    </Card>
  );
}
const NO_SHOW_RESULT = {
  start: {
    owner:
      "Tanpa bantahan, transaksi dibatalkan, dana dikembalikan penuh ke penyewa, dan kamu mendapat strike.",
    renter: "Tanpa bantahan, transaksi dibatalkan dengan biaya batal dan kamu mendapat strike.",
  },
  end: {
    owner: "Tanpa bantahan, denda telat penyewa berhenti dihitung dan kamu mendapat strike.",
    renter: "Tanpa bantahan, kamu dihitung terlambat mengembalikan barang.",
  },
} as const;
// "Pihak lain tidak datang" for the party who arrived; rebuttal for the reported party (F11).
export function NoShowPanel({ data, refresh }: Props) {
  const r = data.rental,
    a = data.actions,
    me = myId(data),
    pending = data.noShows.find((report) => report.status === "menunggu"),
    action = useAction(refresh),
    [contest, setContest] = useState(false);
  if (!a.phase || (!pending && !a.canReportNoShow)) return null;
  if (!pending)
    return (
      <Card className="min-w-0">
        <h3 className="text-xl">Pihak lain belum datang?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Kamu sudah di titik dan sudah lewat {r.rulesSnapshot.no_show_wait_minutes} menit dari
          jadwal. Laporkan agar pihak lain punya {r.rulesSnapshot.no_show_response_hours} jam untuk
          membantah.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          disabled={action.busy}
          onClick={() => void action.run(() => post(`/api/rentals/${r.id}/no-show`, {}))}
        >
          Pihak lain tidak datang
        </Button>
        <ErrorNote error={action.error} />
      </Card>
    );
  const reportedMe = pending.reportedParty === me,
    reportedRole = pending.reportedParty === r.ownerId ? "owner" : "renter";
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-xl">Laporan tidak hadir</h3>
        <StatusChip tone="warning">Menunggu bantahan</StatusChip>
      </div>
      <p className="mt-2 text-sm">
        {reportedMe
          ? `Kamu dilaporkan tidak datang saat ${pending.phase === "start" ? "serah terima" : "pengembalian"}. ${NO_SHOW_RESULT[pending.phase][reportedRole]}`
          : "Kamu melaporkan pihak lain tidak datang. Bila tidak ada bantahan sampai batas waktu, konsekuensinya diterapkan otomatis."}
      </p>
      <Countdown target={pending.respondBy} label="Batas bantahan" />
      {a.canContestNoShow &&
        (contest ? (
          <DisputeForm
            categories={["tidak_hadir"]}
            label="Kirim bantahan"
            onCancel={() => setContest(false)}
            submit={async (input) => {
              await post(`/api/rentals/${r.id}/no-show/${pending.id}/dispute`, {
                description: input.description,
                evidencePaths: input.evidencePaths,
              });
              await refresh();
            }}
          />
        ) : (
          <Button className="mt-4" variant="outline" onClick={() => setContest(true)}>
            Bantah laporan
          </Button>
        ))}
    </Card>
  );
}
// Reschedule proposals take effect only after the other party agrees (A-3.5).
export function ReschedulePanel({ data, refresh }: Props) {
  const id = useId(),
    r = data.rental,
    pending = data.reschedules.find((request) => request.status === "menunggu"),
    action = useAction(refresh),
    [open, setOpen] = useState(false),
    [value, setValue] = useState("");
  if (!pending && !data.actions.canReschedule) return null;
  const left = r.rulesSnapshot.reschedule_max - r.rescheduleCount;
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">Jadwal ulang serah terima</h3>
      {pending ? (
        pending.proposedBy === myId(data) ? (
          <p className="mt-2 text-sm">
            Menunggu pihak lain menyetujui jadwal baru{" "}
            <strong>{dateWib(pending.newStartAt)}</strong>.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              Pihak lain mengusulkan jadwal baru <strong>{dateWib(pending.newStartAt)}</strong>.
              Jatuh tempo ikut bergeser dengan durasi yang sama.
            </p>
            {data.actions.canRespondReschedule && (
              <div className="mt-4 flex flex-wrap gap-2">
                {(["disetujui", "ditolak"] as const).map((decision) => (
                  <Button
                    key={decision}
                    variant={decision === "disetujui" ? "default" : "outline"}
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(() =>
                        post(`/api/rentals/${r.id}/reschedule/${pending.id}/respond`, {
                          version: r.version,
                          decision,
                        }),
                      )
                    }
                  >
                    {decision === "disetujui" ? "Setujui jadwal baru" : "Tolak usulan"}
                  </Button>
                ))}
              </div>
            )}
          </>
        )
      ) : open ? (
        <form
          className="form-stack mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await post(`/api/rentals/${r.id}/reschedule`, {
                version: r.version,
                startAt: new Date(`${value}+07:00`).toISOString(),
              });
              setOpen(false);
            });
          }}
        >
          <div>
            <label className="field-label" htmlFor={id}>
              Jadwal mulai baru (WIB)
            </label>
            <Input
              id={id}
              type="datetime-local"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="help">
              Harus dalam jam operasional titik dan tidak bentrok. Sisa jadwal ulang: {left} kali.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={action.busy || !value}>
              Kirim usulan
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Berhalangan datang? Usulkan jadwal baru; berlaku setelah pihak lain setuju. Sisa {left}{" "}
            kali.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => setOpen(true)}>
            Usulkan jadwal baru
          </Button>
        </>
      )}
      <ErrorNote error={action.error} />
    </Card>
  );
}
// Consequences from A-3.6 are shown before the user confirms (F11).
export function CancelPanel({ data, refresh }: Props) {
  const id = useId(),
    r = data.rental,
    c = data.cancellation,
    action = useAction(refresh),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState("");
  if (!c) return null;
  const paid = r.status === "DIBAYAR",
    label = paid ? "Batalkan transaksi" : "Batalkan pengajuan";
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="w-full rounded-2xl border border-border p-4">
      <h4 className="text-base font-bold">Konsekuensi pembatalan</h4>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
        <li>
          Dikembalikan ke penyewa: <strong>{rupiah(c.refund)}</strong>
          {r.amountReceived === 0 && " (belum ada dana masuk)"}
        </li>
        {c.fee > 0 && (
          <li>
            Biaya batal {r.rulesSnapshot.cancellation_rate_bp / 100}% sewa {rupiah(c.fee)}: pemilik
            menerima {rupiah(c.owner)}, komisi {rupiah(c.commission)}.
          </li>
        )}
        {paid && c.fee === 0 && !c.strike && (
          <li>
            Tanpa biaya karena masih lebih dari {r.rulesSnapshot.cancel_free_hours} jam sebelum
            jadwal (sampai {dateWib(c.freeUntil)}).
          </li>
        )}
        {c.strike && <li>Pemilik yang membatalkan setelah dibayar mendapat 1 strike.</li>}
      </ul>
      <label className="field-label mt-4" htmlFor={id}>
        Alasan (opsional)
      </label>
      <Input
        id={id}
        maxLength={1000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={action.busy}
          onClick={() =>
            void action.run(() =>
              post(`/api/rentals/${r.id}/cancel`, {
                version: r.version,
                fee: c.fee,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              }),
            )
          }
        >
          Ya, batalkan
        </Button>
        <Button variant="outline" disabled={action.busy} onClick={() => setOpen(false)}>
          Kembali
        </Button>
      </div>
      <ErrorNote error={action.error} />
    </div>
  );
}
function EvidenceForm({ data, refresh }: Props) {
  const id = useId(),
    dispute = data.dispute!,
    [files, setFiles] = useState<File[]>([]),
    [note, setNote] = useState(""),
    [progress, setProgress] = useState(""),
    action = useAction(refresh);
  return (
    <form
      className="form-stack mt-5 border-t border-border pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          if (!files.length) throw new Error("Pilih minimal satu file bukti.");
          const paths = await uploadAll(files, setProgress);
          await post(`/api/disputes/${dispute.id}/evidence`, {
            paths,
            ...(note.trim() ? { note: note.trim() } : {}),
          });
          setFiles([]);
          setNote("");
          setProgress("");
        });
      }}
    >
      <h4 className="text-base font-bold">Tambah bukti</h4>
      <EvidenceInput files={files} onChange={setFiles} />
      <div>
        <label className="field-label" htmlFor={id}>
          Catatan untuk admin (opsional)
        </label>
        <Input
          id={id}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={action.busy}>
        {action.busy ? progress || "Mengirim…" : "Kirim bukti"}
      </Button>
      <ErrorNote error={action.error} />
    </form>
  );
}
// Dispute status for both parties; the admin decision itself follows in Sprint 5 (F24).
export function DisputePanel({ data, refresh }: Props) {
  const r = data.rental,
    d = data.dispute;
  if (!d) return null;
  const who = (userId: string | null) =>
    userId === r.ownerId ? "pemilik" : userId === r.renterId ? "penyewa" : "sistem";
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-xl">Sengketa: {d.label}</h3>
        <StatusChip tone={d.status === "dibuka" ? "danger" : "neutral"}>
          {d.status === "dibuka" ? "Dalam mediasi" : "Diputuskan"}
        </StatusChip>
      </div>
      <p className="mt-3 text-sm break-words whitespace-pre-line">{d.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Dibuka {dateWib(d.createdAt)} oleh {who(d.openedBy)}. Dana tetap ditahan sampai admin
        memutuskan.
      </p>
      {d.status === "dibuka" && (
        <>
          <Countdown target={d.respondBy} label="Batas tanggapan dan bukti" />
          <Countdown target={d.decideBy} label="Target putusan admin" />
        </>
      )}
      {d.evidence.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {d.evidence.map((item, index) => (
            <li key={item.id} className="break-words">
              <a
                className="font-bold text-primary"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                Bukti {index + 1} ({item.pdf ? "PDF" : "foto"}) ↗
              </a>{" "}
              <span className="text-muted-foreground">
                dari {who(item.uploadedBy)} · {dateWib(item.createdAt)}
              </span>
              {item.note && <p className="mt-1">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {data.actions.canAddEvidence && <EvidenceForm data={data} refresh={refresh} />}
    </Card>
  );
}
export function PhotoGallery({ data }: { data: RentalDetail }) {
  const sections = (
    [
      ["Kondisi awal (serah terima)", data.handover.start],
      ["Kondisi akhir (pengembalian)", data.handover.end],
    ] as const
  ).filter(([, record]) => record && record.photos.length);
  if (!sections.length) return null;
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">Foto kondisi</h3>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {sections.map(([title, record]) => (
          <section key={title} aria-label={title}>
            <h4 className="text-sm font-bold">{title}</h4>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {record!.photos.map((photo) => (
                <li key={photo.id}>
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    <Image
                      src={photo.url}
                      unoptimized
                      width={240}
                      height={180}
                      alt={`${title} ${dateWib(photo.receivedAt)}`}
                      className="aspect-[4/3] w-full rounded-lg object-cover"
                    />
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateWib(photo.receivedAt)}
                    {photo.source === "gallery" && " · dari galeri"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
const KIND_LABELS: Record<string, string> = {
  pencairan_pemilik: "Pencairan ke pemilik",
  refund_penyewa: "Refund ke penyewa",
  penyesuaian: "Penyesuaian",
};
// Settlement and payout proofs (F12); each recipient sees their own transfer proof.
export function PayoutList({ data }: { data: RentalDetail }) {
  const id = useId(),
    s = data.rental.settlement;
  if (!data.payouts.length && !s) return null;
  return (
    <Card className="min-w-0" aria-labelledby={id}>
      <h3 id={id} className="text-xl">
        Pencairan &amp; refund
      </h3>
      {s && (
        <dl className="mt-4 space-y-2 text-sm">
          {(
            [
              ["Dana diterima platform", s.received],
              ["Bagian pemilik", s.owner],
              ["Bagian penyewa", s.renter],
              ["Komisi platform", s.commission],
              ...(s.lateFee ? [["Termasuk denda telat", s.lateFee]] : []),
              ...(s.cancellationFee ? [["Termasuk biaya batal", s.cancellationFee]] : []),
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular font-bold">{rupiah(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="mt-4 divide-y divide-border">
        {data.payouts.map((task) => (
          <li key={task.id} className="py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                {KIND_LABELS[task.kind]} · {rupiah(task.amount)}
              </strong>
              <StatusChip tone={task.status === "selesai" ? "success" : "warning"}>
                {task.status === "selesai" ? "Sudah ditransfer" : "Diproses admin"}
              </StatusChip>
            </div>
            <p className="mt-1 text-muted-foreground">
              {task.status === "selesai" && task.transferredAt
                ? `Ditransfer ${dateWib(task.transferredAt)}`
                : `Target selesai ${dateWib(task.targetAt)}`}
            </p>
            {task.account && (
              <p className="mt-1 break-words">
                Ke {task.account.provider} {task.account.accountNo ?? ""} a.n.{" "}
                {task.account.accountName}
              </p>
            )}
            {task.proofUrl && (
              <a
                className="mt-2 inline-flex min-h-11 items-center font-bold text-primary"
                href={task.proofUrl}
                target="_blank"
                rel="noreferrer"
              >
                Lihat bukti transfer ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
