"use client";
import { useState } from "react";
import Image from "next/image";
import { useClock, useLiveApi, type Wire } from "@/src/lib/live-api";
import type { disputeDetail, disputeQueue } from "@/src/services/dispute-service";
import { DISPUTE_LABELS } from "@/src/domain/dispute";
import { RENTAL_LABELS } from "@/src/domain/rental-state-machine";
import { dateWib, rupiah } from "@/src/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { AdminActionForm } from "./admin-trust";

type Queue = Wire<Awaited<ReturnType<typeof disputeQueue>>>;
type Detail = Wire<Awaited<ReturnType<typeof disputeDetail>>>;
export function AdminDisputes() {
  const now = useClock(),
    query = useLiveApi<Queue>("/api/admin/disputes", 5000),
    [selected, setSelected] = useState("");
  return (
    <>
      <h1 className="text-3xl">Sengketa</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Periksa bukti dan tanggapan kedua pihak sebelum memutuskan. Dana ditahan sampai putusan.
      </p>
      {query.error && (
        <p className="notice notice-error mb-4" role="alert">
          {query.error}
        </p>
      )}
      <div className="min-w-0 space-y-5">
        <Card className="min-w-0">
          {!query.data && !query.error && (
            <div className="skeleton h-40" role="status" aria-label="Memuat sengketa" />
          )}
          {query.data?.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Tidak ada sengketa terbuka.
            </p>
          )}
          <ul className="divide-y divide-border">
            {query.data?.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-bold">
                    {row.publicCode} · {DISPUTE_LABELS[row.category]}
                  </p>
                  <p className="mt-1 break-words text-muted-foreground">
                    {row.title} · dari {RENTAL_LABELS[row.openedFromStatus]} · dibuka{" "}
                    {row.openedByName ?? "sistem"} {dateWib(row.createdAt)}
                  </p>
                  <p
                    className={`mt-1 text-xs ${Date.parse(row.decideBy) < now ? "font-bold text-destructive" : "text-muted-foreground"}`}
                  >
                    Target putusan {dateWib(row.decideBy)}
                    {Date.parse(row.decideBy) < now && " · lewat target"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setSelected(row.id)}>
                  Lihat bukti
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        {selected && <DisputeReview key={selected} id={selected} />}
      </div>
    </>
  );
}
function DisputeReview({ id }: { id: string }) {
  const query = useLiveApi<Detail>(`/api/admin/disputes/${id}`, 5000);
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
        <div className="skeleton h-80" role="status" aria-label="Memuat bukti sengketa" />
      </Card>
    );
  const { dispute, rental, people, photos, history, messages } = query.data,
    name = (userId: string | null) =>
      people.find((person) => person.id === userId)?.name ?? "Sistem";
  return (
    <Card className="min-w-0">
      <p className="text-sm text-muted-foreground">{rental.publicCode}</p>
      <h2 className="mt-1 text-2xl break-words">
        {dispute.label}: {rental.title}
      </h2>
      <p className="mt-3 text-sm break-words whitespace-pre-line">{dispute.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Dibuka {name(dispute.openedBy)} · {dateWib(dispute.createdAt)} · batas tanggapan{" "}
        {dateWib(dispute.respondBy)}
      </p>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        {(
          [
            ["Dana diterima", rental.amountReceived],
            ["Komisi platform", rental.commissionAmount],
            ["Saran denda telat", rental.lateFee],
          ] as [string, number][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border p-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular mt-1 font-bold">{rupiah(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {(["start", "end"] as const).map((type) => (
          <section key={type} aria-label={type === "start" ? "Foto awal" : "Foto akhir"}>
            <h3 className="text-base">
              {type === "start" ? "Foto kondisi awal" : "Foto kondisi akhir"}
            </h3>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {photos
                .filter((photo) => photo.type === type)
                .map((photo) => (
                  <li key={photo.id}>
                    <a href={photo.url} target="_blank" rel="noreferrer">
                      <Image
                        src={photo.url}
                        unoptimized
                        width={260}
                        height={195}
                        alt={`Foto ${type === "start" ? "awal" : "akhir"} ${dateWib(photo.receivedAt)}`}
                        className="aspect-[4/3] w-full rounded-lg object-cover"
                      />
                    </a>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateWib(photo.receivedAt)}
                      {photo.source === "gallery" && " · dari galeri"}
                      {!photo.currentSchedule && " · jadwal sebelumnya"}
                    </p>
                  </li>
                ))}
            </ul>
            {!photos.some((photo) => photo.type === type) && (
              <p className="mt-2 text-sm text-muted-foreground">Belum ada foto.</p>
            )}
          </section>
        ))}
      </div>
      <section className="mt-6" aria-label="Bukti sengketa">
        <h3 className="text-base">Bukti kedua pihak</h3>
        {dispute.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Belum ada file bukti.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {dispute.evidence.map((item, index) => (
              <li key={item.id}>
                <a
                  className="font-bold text-primary"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Bukti {index + 1} ({item.pdf ? "PDF" : "foto"}) ↗
                </a>{" "}
                <span className="text-muted-foreground">
                  {name(item.uploadedBy)} · {dateWib(item.createdAt)}
                </span>
                {item.note && <p className="mt-1 break-words">{item.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h3 className="text-base">Tanggapan</h3>
        {dispute.responses.map((r) => (
          <div className="mt-3 text-sm" key={r.id}>
            <strong>
              {name(r.userId)} · {dateWib(r.createdAt)}
            </strong>
            <p className="mt-1 break-words whitespace-pre-line">{r.body}</p>
          </div>
        ))}
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section aria-label="Chat transaksi">
          <h3 className="text-base">Chat (akses tercatat di audit log)</h3>
          <ol className="mt-2 max-h-96 space-y-2 overflow-y-auto rounded-xl border border-border p-3 text-sm">
            {messages.map((message) => (
              <li key={message.id} className="break-words">
                <span className="text-xs text-muted-foreground">
                  {dateWib(message.createdAt)} ·{" "}
                  {message.type === "system" ? "Sistem" : name(message.senderId)}
                </span>
                <p>{message.originalBody ?? message.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section aria-label="Riwayat status">
          <h3 className="text-base">Riwayat</h3>
          <ol className="mt-2 space-y-2 text-sm">
            {history.map((event) => (
              <li key={event.id}>
                <strong>{RENTAL_LABELS[event.toStatus]}</strong>{" "}
                <span className="text-xs text-muted-foreground">
                  {dateWib(event.createdAt)} · {event.actorType}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {dispute.status === "dibuka" &&
        (query.data.self ? (
          <p className="notice mt-6">Sengketa transaksimu harus diputuskan admin lain.</p>
        ) : (
          <DisputeDecision detail={query.data} refresh={query.refresh} />
        ))}
    </Card>
  );
}
function DisputeDecision({ detail, refresh }: { detail: Detail; refresh: () => unknown }) {
  const [outcome, setOutcome] = useState("lanjutkan"),
    d = detail.dispute,
    r = detail.rental;
  const available =
    d.openedFromStatus === "DIBAYAR"
      ? ["lanjutkan", "batal"]
      : d.openedFromStatus === "BERJALAN"
        ? ["lanjutkan", "bagi_dana"]
        : ["bagi_dana"];
  const chosen = available.includes(outcome) ? outcome : available[0];
  return (
    <section className="mt-6 border-t border-border pt-6">
      <h3 className="text-xl">Putusan admin</h3>
      <label className="field-label mt-3">
        Jenis putusan
        <select className="input mt-1" value={chosen} onChange={(e) => setOutcome(e.target.value)}>
          {available.map((v) => (
            <option key={v} value={v}>
              {v.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {chosen !== "lanjutkan" && (
        <p className="notice mt-3">
          Dana diterima {rupiah(r.amountReceived)}. Komisi{" "}
          {rupiah(chosen === "bagi_dana" ? r.commissionAmount : 0)}. Jumlah bagian kedua pihak harus{" "}
          {rupiah(r.amountReceived - (chosen === "bagi_dana" ? r.commissionAmount : 0))}.
        </p>
      )}
      <AdminActionForm
        key={chosen}
        url={`/api/admin/disputes/${d.id}/decision`}
        values={{ outcome: chosen, version: r.version }}
        label="Simpan putusan"
        done={refresh}
        fields={[
          ...(chosen === "lanjutkan" && d.openedFromStatus === "DIBAYAR"
            ? [
                {
                  name: "newStartAt",
                  label: "Jadwal serah terima baru (WIB)",
                  type: "datetime-local" as const,
                },
              ]
            : []),
          ...(chosen !== "lanjutkan"
            ? [
                { name: "ownerAmount", label: "Bagian pemilik (Rp)", type: "number" as const },
                { name: "renterAmount", label: "Bagian penyewa (Rp)", type: "number" as const },
              ]
            : []),
          { name: "reason", label: "Alasan putusan", type: "textarea" },
          {
            name: "strikeUserId",
            label: "Strike ke pihak bersalah (opsional)",
            optional: true,
            options: detail.people.map((p) => ({ value: p.id, label: p.name })),
          },
        ]}
      />
    </section>
  );
}
