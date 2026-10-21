import { BadgeCheck, Circle, Clock3, CircleAlert, Info } from "lucide-react";
const tones = {
  success: [BadgeCheck, "var(--color-success)", "var(--color-success-bg)"],
  warning: [Clock3, "var(--color-warning)", "var(--color-warning-bg)"],
  danger: [CircleAlert, "var(--color-danger)", "var(--color-danger-bg)"],
  neutral: [Circle, "var(--color-neutral)", "var(--color-neutral-bg)"],
  info: [Info, "var(--color-info)", "var(--color-info-bg)"],
} as const;
export function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  const [Icon, color, background] = tones[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
      style={{ color, background }}
    >
      <Icon size={14} aria-hidden />
      {children}
    </span>
  );
}
export function VerificationChip({ status }: { status: string }) {
  const values: Record<string, [keyof typeof tones, string]> = {
    belum: ["neutral", "Belum diverifikasi"],
    menunggu: ["warning", "Sedang ditinjau"],
    terverifikasi: ["success", "Terverifikasi"],
    ditolak: ["danger", "Perlu perbaikan"],
  };
  const [tone, label] = values[status] || values.belum;
  return <StatusChip tone={tone}>{label}</StatusChip>;
}
