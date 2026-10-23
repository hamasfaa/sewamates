"use client";
import { useState } from "react";
import Link from "next/link";
import { api, useApi } from "@/src/lib/client-api";
import { useLiveApi, type Wire } from "@/src/lib/live-api";
import type { publicReviews, rentalReviews } from "@/src/services/review-service";
import { REVIEW_TAGS } from "@/src/lib/trust-validation";
import { dateWib } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function ReportControl({ type, id }: { type: "user" | "item" | "review"; id: string }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [note, setNote] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 text-left text-sm">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
        Laporkan {type === "item" ? "listing" : type === "review" ? "ulasan" : "pengguna"}
      </Button>
      {open && (
        <form
          className="mt-2 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              await api("/api/reports", {
                method: "POST",
                body: JSON.stringify({ targetType: type, targetId: id, reason, note }),
              });
              setMessage("Laporan terkirim. Admin akan meninjaunya.");
              setOpen(false);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label">
            Alasan laporan
            <select
              className="input mt-1"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Pilih alasan</option>
              {[
                "Penipuan atau informasi palsu",
                "Konten tidak pantas",
                "Pelecehan atau ancaman",
                "Barang terlarang",
                "Alasan lainnya",
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Penjelasan tambahan
            <textarea
              className="input mt-1"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Kirim laporan
          </Button>
        </form>
      )}
      {message && (
        <p className="notice mt-2" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function BlockControl({ id }: { id: string }) {
  const query = useApi<{ id: string; name: string }[]>("/api/me/blocks"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!query.data) return null;
  const blocked = query.data.some((u) => u.id === id);
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/users/${id}/block`, {
              method: blocked ? "DELETE" : "POST",
              body: "{}",
            });
            query.reload();
            setMessage(
              blocked ? "Blokir dibuka." : "Pengguna diblokir. Kewajiban transaksi tetap berlaku.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {blocked ? "Buka blokir" : "Blokir pengguna"}
      </Button>
      {message && (
        <p className="help mt-2" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function PublicReviews({
  type,
  id,
  viewerId,
}: {
  type: "users" | "items";
  id: string;
  viewerId?: string;
}) {
  const query = useApi<Wire<Awaited<ReturnType<typeof publicReviews>>>>(
    `/api/${type}/${id}/reviews`,
  );
  return (
    <div className="space-y-3">
      {query.error && <p role="alert">{query.error}</p>}
      {query.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada ulasan yang dipublikasikan.</p>
      )}
      {query.data?.map((r) => (
        <Card key={r.id} className="min-w-0 p-4">
          <p className="font-bold">
            {"★".repeat(r.score)} <span className="text-sm">{r.score}/5</span>
          </p>
          <Link className="text-sm text-primary" href={`/pengguna/${r.reviewerId}`}>
            {r.reviewerName}
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">{r.tags.join(" · ")}</p>
          <p className="mt-2 break-words text-sm whitespace-pre-line">{r.comment}</p>
          {r.visibleAt && (
            <p className="mt-2 text-xs text-muted-foreground">{dateWib(r.visibleAt)}</p>
          )}
          {viewerId && viewerId !== r.reviewerId && <ReportControl type="review" id={r.id} />}
        </Card>
      ))}
    </div>
  );
}
type Reviews = Wire<Awaited<ReturnType<typeof rentalReviews>>>;
export function RentalReviewForm({ id }: { id: string }) {
  const query = useLiveApi<Reviews>(`/api/rentals/${id}/reviews`, 5000);
  if (!query.data)
    return query.error ? (
      <p className="notice notice-error" role="alert">
        {query.error}
      </p>
    ) : null;
  const d = query.data;
  if (!d.canReview && !d.mine && !d.received.length) return null;
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">Ulasan transaksi</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Ulasan terlihat setelah kedua pihak mengisi atau masa penilaian berakhir.
        {d.endsAt && ` Batas penilaian ${dateWib(d.endsAt)}.`}
      </p>
      {d.canReview ? (
        <ReviewEditor key={d.mine?.id || "new"} id={id} mine={d.mine} refresh={query.refresh} />
      ) : (
        d.mine && (
          <p className="notice mt-4">
            Ulasanmu: {d.mine.score}/5 ·{" "}
            {d.mine.visibleAt ? "Sudah dipublikasikan" : "Menunggu publikasi"}
          </p>
        )
      )}
      {d.received.map((r) => (
        <div className="mt-4 border-t border-border pt-4" key={r.id}>
          <p className="font-bold">Ulasan untukmu: {r.score}/5</p>
          <p className="text-sm">{r.tags.join(" · ")}</p>
          <p className="mt-2 break-words text-sm">{r.comment}</p>
          <ReportControl type="review" id={r.id} />
        </div>
      ))}
    </Card>
  );
}
function ReviewEditor({
  id,
  mine,
  refresh,
}: {
  id: string;
  mine: Reviews["mine"];
  refresh: () => unknown;
}) {
  const [score, setScore] = useState(mine?.score || 5),
    [tags, setTags] = useState<string[]>(mine?.tags || []),
    [comment, setComment] = useState(mine?.comment || ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/api/rentals/${id}/reviews`, {
            method: "POST",
            body: JSON.stringify({ score, tags, comment }),
          });
          setMessage("Ulasan disimpan.");
          void refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label">
        Bintang
        <select
          className="input mt-1"
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option value={n} key={n}>
              {n} bintang
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="field-label">Tag cepat</legend>
        <div className="flex flex-wrap gap-3">
          {REVIEW_TAGS.map((tag) => (
            <label key={tag} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tags.includes(tag)}
                onChange={(e) =>
                  setTags(e.target.checked ? [...tags, tag] : tags.filter((t) => t !== tag))
                }
              />
              {tag}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field-label">
        Komentar (opsional)
        <textarea
          className="input mt-1"
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={busy}>
        {mine ? "Perbarui ulasan" : "Kirim ulasan"}
      </Button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
export function DisputeResponseForm({ id, refresh }: { id: string; refresh: () => unknown }) {
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/api/disputes/${id}/respond`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
          setMessage("Tanggapan terkirim.");
          void refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label">
        Tanggapan sengketa
        <textarea
          className="input mt-1 min-h-28"
          required
          minLength={20}
          maxLength={3000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="help">Tambahkan file melalui bagian bukti di bawah.</p>
      <Button type="submit" disabled={busy}>
        Kirim tanggapan
      </Button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
