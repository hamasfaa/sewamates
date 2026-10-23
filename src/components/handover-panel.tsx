"use client";
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Camera, CheckCircle2, ImagePlus, ScanLine, Smartphone } from "lucide-react";
import { api } from "@/src/lib/client-api";
import { compressImage } from "@/src/lib/image";
import { uploadPrivateFile } from "@/src/lib/private-upload";
import { cn, dateWib } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import type { RentalDetail } from "./rental-ui";

type Props = { data: RentalDetail; refresh: () => Promise<void> };
const QR_COLORS = { dark: "#0B1F4D", light: "#FFFFFF" };
// Handover needs a phone at the pickup point; desktops get a QR to the same page (F10).
export function ContinueOnPhone({ id }: { id: string }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(`${window.location.origin}/transaksi/${id}`, {
      width: 168,
      margin: 1,
      color: QR_COLORS,
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <div className="mt-5 hidden items-center gap-5 rounded-2xl border border-border p-5 lg:flex">
      {qr ? (
        <Image
          src={qr}
          unoptimized
          width={168}
          height={168}
          alt="QR untuk membuka transaksi ini di HP"
        />
      ) : (
        <div className="skeleton size-[168px] shrink-0" />
      )}
      <div>
        <h4 className="flex items-center gap-2 text-lg font-bold">
          <Smartphone size={20} aria-hidden="true" />
          Lanjutkan di HP
        </h4>
        <p className="mt-2 text-sm text-muted-foreground">
          Langkah serah terima dan pengembalian (tiba di titik, foto kondisi, dan tukar kode)
          dilakukan dari HP di lokasi. Pindai QR ini dengan kamera HP untuk membuka transaksi yang
          sama.
        </p>
      </div>
    </div>
  );
}
function captureFrame(video: HTMLVideoElement) {
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak mendukung pemrosesan foto.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Foto tidak dapat diproses."))),
      "image/jpeg",
      0.85,
    ),
  );
}
// In-app camera via getUserMedia; the file picker fallback is labelled "dari galeri" for admins.
function CameraCapture({
  disabled,
  onPhoto,
}: {
  disabled: boolean;
  onPhoto: (photo: Blob, source: "camera" | "gallery") => Promise<void>;
}) {
  const id = useId(),
    video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null),
    [stream, setStream] = useState<MediaStream | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const element = video.current;
    if (element && stream) {
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    }
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);
  async function open() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      setStream(
        await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        }),
      );
    } catch {
      setError(
        'Kamera tidak tersedia atau izinnya ditolak. Pilih foto dari galeri; fotonya ditandai "dari galeri" untuk admin.',
      );
    }
  }
  async function send(work: () => Promise<Blob>, source: "camera" | "gallery") {
    setBusy(true);
    setError("");
    try {
      await onPhoto(await work(), source);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <div className="mt-3">
      {stream ? (
        <div>
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            aria-label="Pratinjau kamera"
            className="aspect-[4/3] w-full rounded-xl bg-black object-cover"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy || disabled}
              onClick={() =>
                void send(async () => {
                  if (!video.current?.videoWidth) throw new Error("Kamera belum siap. Coba lagi.");
                  return captureFrame(video.current);
                }, "camera")
              }
            >
              <Camera size={18} aria-hidden="true" />
              {busy ? "Mengunggah…" : "Ambil foto"}
            </Button>
            <Button variant="outline" onClick={() => setStream(null)}>
              Tutup kamera
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={busy || disabled} onClick={() => void open()}>
          <Camera size={18} aria-hidden="true" />
          Buka kamera
        </Button>
      )}
      <div className="mt-3">
        <label className="field-label flex items-center gap-2" htmlFor={id}>
          <ImagePlus size={16} aria-hidden="true" />
          Pilih dari galeri
        </label>
        <Input
          id={id}
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || disabled}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void send(() => compressImage(chosen), "gallery");
          }}
        />
        <p id={`${id}-help`} className="help">
          Foto dari galeri ditandai untuk admin. Waktu foto memakai waktu server saat diunggah.
        </p>
      </div>
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function CodeDisplay({ data }: { data: RentalDetail }) {
  const r = data.rental,
    [code, setCode] = useState(""),
    [qr, setQr] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function show() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ code: string }>(`/api/rentals/${r.id}/handover/code`, {
        method: "POST",
        body: "{}",
      });
      setCode(result.code);
      // The fragment never reaches the server; the other phone's camera opens this page prefilled.
      setQr(
        await QRCode.toDataURL(`${window.location.origin}/transaksi/${r.id}#kode=${result.code}`, {
          width: 200,
          margin: 1,
          color: QR_COLORS,
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const receiver = data.actions.phase === "start" ? "pemilik" : "penyewa";
  return (
    <div className="mt-3">
      {code ? (
        <div className="rounded-2xl border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">Kode untuk {receiver}</p>
          <p
            className="tabular mt-2 text-4xl font-extrabold tracking-[0.3em]"
            aria-label={`Kode ${code.split("").join(" ")}`}
          >
            {code}
          </p>
          {qr && (
            <Image
              src={qr}
              unoptimized
              width={200}
              height={200}
              className="mx-auto mt-3"
              alt="QR kode serah terima"
            />
          )}
          <p className="help">
            Tunjukkan kode atau QR ini ke {receiver}. Membuat kode baru membatalkan kode lama.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void show()}
          >
            Buat kode baru
          </Button>
        </div>
      ) : (
        <Button disabled={busy} onClick={() => void show()}>
          {busy ? "Menyiapkan…" : "Tampilkan kode"}
        </Button>
      )}
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;
const codeFrom = (text: string) => text.match(/kode=(\d{6})/)?.[1] ?? text.match(/^\d{6}$/)?.[0];
// Code typed or scanned with BarcodeDetector where the browser has it; iOS can use its camera app.
function CodeEntry({ data, refresh }: Props) {
  const id = useId(),
    r = data.rental,
    start = data.actions.phase === "start",
    [code, setCode] = useState(() => codeFrom(window.location.hash) ?? ""),
    [photosOk, setPhotosOk] = useState(false),
    [scanning, setScanning] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    video = useRef<HTMLVideoElement>(null);
  const Scanner = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  useEffect(() => {
    if (!scanning || !Scanner) return;
    let stream: MediaStream | undefined,
      timer: ReturnType<typeof setInterval> | undefined,
      active = true;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new Scanner({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          if (!video.current?.videoWidth) return;
          const found = (await detector.detect(video.current).catch(() => []))
            .map((item) => codeFrom(item.rawValue))
            .find(Boolean);
          if (found && active) {
            setCode(found);
            setScanning(false);
          }
        }, 400);
      } catch {
        if (active) {
          setError("Kamera tidak bisa dipakai untuk memindai. Ketik kodenya.");
          setScanning(false);
        }
      }
    })();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning, Scanner]);
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/rentals/${r.id}/handover/confirm`, {
        method: "POST",
        body: JSON.stringify({ code, ...(start ? { photosConfirmed: photosOk } : {}) }),
      });
      if (window.location.hash) history.replaceState(null, "", window.location.pathname);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const locked = start ? data.handover.start?.codeLockedUntil : data.handover.end?.codeLockedUntil;
  return (
    <form className="form-stack mt-3" onSubmit={confirm}>
      {start && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={photosOk}
            onChange={(event) => setPhotosOk(event.target.checked)}
          />
          Saya sudah memeriksa foto kondisi dari penyewa dan sesuai dengan barang yang diserahkan.
        </label>
      )}
      <div>
        <label className="field-label" htmlFor={id}>
          Kode {start ? "serah terima" : "pengembalian"} (6 angka)
        </label>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="tabular text-2xl tracking-[0.3em]"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <p className="help">
          Minta {start ? "penyewa" : "pemilik"} menampilkan kode. Salah 5 kali mengunci 15 menit.
        </p>
      </div>
      {Scanner &&
        (scanning ? (
          <div>
            <video
              ref={video}
              playsInline
              muted
              aria-label="Pemindai QR"
              className="aspect-square w-full rounded-xl bg-black object-cover"
            />
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() => setScanning(false)}
            >
              Berhenti memindai
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => setScanning(true)}>
            <ScanLine size={18} aria-hidden="true" />
            Pindai QR
          </Button>
        ))}
      {locked && (
        <p className="notice notice-error" role="status">
          Input kode dikunci sampai {dateWib(locked)}.
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || code.length !== 6 || (start && !photosOk)}>
        {busy ? "Memeriksa…" : start ? "Konfirmasi serah terima" : "Konfirmasi pengembalian"}
      </Button>
    </form>
  );
}
function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="border-l-2 border-border pb-6 pl-5 last:pb-0">
      <h4 className="-ml-[33px] flex items-center gap-3 text-base font-bold">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-bold",
            done ? "bg-primary text-white" : "bg-secondary text-primary",
          )}
          aria-hidden="true"
        >
          {done ? <CheckCircle2 size={16} /> : number}
        </span>
        {title}
        {done && <span className="sr-only">(selesai)</span>}
      </h4>
      <div className="mt-2 text-sm">{children}</div>
    </li>
  );
}
async function currentLocation() {
  if (!navigator.geolocation) return undefined;
  return new Promise<{ latitude: number; longitude: number; accuracy: number } | undefined>(
    (resolve) =>
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          resolve({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: Math.min(coords.accuracy, 100000),
          }),
        () => resolve(undefined),
        { timeout: 8000, maximumAge: 60000 },
      ),
  );
}
// Guided steps from A-3.5: arrive → photos → code. Phones only; desktops see ContinueOnPhone.
export function HandoverPanel({ data, refresh }: Props) {
  const r = data.rental,
    a = data.actions,
    start = a.phase === "start",
    owner = data.viewer.isOwner,
    record = start ? data.handover.start : data.handover.end,
    mine = owner ? record?.ownerArrivedAt : record?.renterArrivedAt,
    theirs = owner ? record?.renterArrivedAt : record?.ownerArrivedAt,
    shooterId = start ? r.renterId : r.ownerId,
    shooter = shooterId === (owner ? r.ownerId : r.renterId),
    photos = record?.photos.filter((photo) => photo.uploadedBy === shooterId) ?? [],
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const other = owner ? "Penyewa" : "Pemilik";
  return (
    <Card className="min-w-0">
      <h3 className="text-xl">{start ? "Serah terima barang" : "Pengembalian barang"}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {start ? "Jadwal" : "Jatuh tempo"} {dateWib(start ? r.startAt : r.dueAt)} di{" "}
        {String((r.listingSnapshot.point as { name?: string })?.name ?? "titik serah terima")}.
        {!start && " Pengembalian lebih awal boleh; atur waktunya lewat chat."}
      </p>
      <ContinueOnPhone id={r.id} />
      <ol
        className="mt-6 ml-3 lg:hidden"
        aria-label={`Langkah ${start ? "serah terima" : "pengembalian"}`}
      >
        <Step number={1} title="Saya sudah sampai" done={Boolean(mine)}>
          {mine ? (
            <p>Kamu tercatat sampai {dateWib(mine)}.</p>
          ) : a.canArrive ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  api(`/api/rentals/${r.id}/arrive`, {
                    method: "POST",
                    body: JSON.stringify({ location: await currentLocation() }),
                  }),
                )
              }
            >
              Saya sudah sampai
            </Button>
          ) : (
            <p>Tombol aktif mulai {a.checkInOpensAt ? dateWib(a.checkInOpensAt) : "jadwal"}.</p>
          )}
          <p className="mt-2 text-muted-foreground">
            {theirs
              ? `${other} sudah sampai ${dateWib(theirs)}.`
              : `${other} belum menandai kehadiran.`}
          </p>
        </Step>
        <Step number={2} title="Foto kondisi barang" done={photos.length >= 2}>
          <p>
            {shooter
              ? `Ambil minimal 2 foto kondisi ${start ? "awal" : "akhir"} (${photos.length}/8).`
              : `${other} mengambil minimal 2 foto kondisi ${start ? "awal" : "akhir"} (${photos.length} terunggah).`}
          </p>
          {photos.length > 0 && (
            <ul className="mt-3 grid grid-cols-3 gap-2" aria-label="Foto kondisi terunggah">
              {photos.map((photo) => (
                <li key={photo.id}>
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    <Image
                      src={photo.url}
                      unoptimized
                      width={160}
                      height={120}
                      alt={`Foto kondisi ${dateWib(photo.receivedAt)}`}
                      className="aspect-[4/3] w-full rounded-lg object-cover"
                    />
                  </a>
                  {photo.source === "gallery" && (
                    <p className="mt-1 text-xs text-muted-foreground">dari galeri</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shooter && a.canPhoto && (
            <CameraCapture
              disabled={busy}
              onPhoto={async (photo, source) => {
                const path = await uploadPrivateFile(photo, "handover_photo");
                await api(`/api/rentals/${r.id}/handover/photos`, {
                  method: "POST",
                  body: JSON.stringify({ path, source }),
                });
                await refresh();
              }}
            />
          )}
          {shooter && !theirs && (
            <p className="mt-2 text-muted-foreground">
              Foto bisa diambil setelah kedua pihak sampai.
            </p>
          )}
        </Step>
        <Step number={3} title={shooter ? "Tunjukkan kode" : "Masukkan kode"} done={false}>
          {shooter ? (
            a.canShowCode ? (
              <CodeDisplay data={data} />
            ) : (
              <p className="text-muted-foreground">Kode muncul setelah 2 foto kondisi terunggah.</p>
            )
          ) : a.canEnterCode ? (
            <CodeEntry data={data} refresh={refresh} />
          ) : (
            <p className="text-muted-foreground">
              Menunggu foto kondisi dari {other.toLowerCase()}.
            </p>
          )}
        </Step>
      </ol>
      {error && (
        <p className="notice notice-error mt-4" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
