"use client";
import { useState } from "react";
import { api, useApi } from "@/src/lib/client-api";
import { useLiveApi } from "@/src/lib/live-api";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function AccountPreferences() {
  const blocks = useApi<{ id: string; name: string }[]>("/api/me/blocks"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [deleteId, setDeleteId] = useState(""),
    [deleteMessage, setDeleteMessage] = useState(""),
    [agree, setAgree] = useState(false);
  const confirmation = useLiveApi<{ status: string }>(
    deleteId ? `/api/me/confirmations/${deleteId}` : null,
    2000,
  );
  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <h2 className="text-xl">Pengguna diblokir</h2>
        {blocks.error && (
          <p className="notice notice-error mt-3" role="alert">
            {blocks.error}
          </p>
        )}
        {message && (
          <p className="notice mt-3" role="status">
            {message}
          </p>
        )}
        {blocks.data?.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Tidak ada pengguna diblokir.</p>
        )}
        <ul className="mt-3 divide-y divide-border">
          {blocks.data?.map((u) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              key={u.id}
            >
              {u.name}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/users/${u.id}/block`, { method: "DELETE", body: "{}" });
                    blocks.reload();
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Buka blokir
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl text-destructive">Hapus akun</h2>
        <p className="mt-3 text-sm">
          Selesaikan seluruh transaksi, sengketa, dan pencairan lebih dahulu. Data pribadi
          dianonimkan, semua sesi dicabut, dan foto identitas dihapus setelah 30 hari. Riwayat
          transaksi dan bukti tetap tersimpan untuk audit.
        </p>
        <label className="mt-4 flex min-h-11 items-start gap-3 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          Saya memahami dan ingin menghapus akun ini.
        </label>
        <Button
          variant="outline"
          className="mt-3 text-destructive"
          disabled={!agree || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const c = await api<{ id: string }>("/api/me/delete-account", {
                method: "POST",
                body: "{}",
              });
              setDeleteId(c.id);
              setDeleteMessage("Buka Telegram untuk konfirmasi atau membatalkan penghapusan.");
            } catch (e) {
              setDeleteMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Minta hapus akun
        </Button>
        {deleteMessage && (
          <p className="notice mt-3" role="status">
            {deleteMessage}
          </p>
        )}
        {deleteId && (
          <p className="notice mt-3" role="status">
            {confirmation.error
              ? "Jika penghapusan sudah dikonfirmasi di Telegram, akun dan semua sesimu sudah dinonaktifkan."
              : `Konfirmasi Telegram: ${confirmation.data?.status || "menunggu"}.`}
          </p>
        )}
      </Card>
    </div>
  );
}
