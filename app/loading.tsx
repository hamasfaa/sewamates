export default function Loading() {
  return (
    <div className="page-container py-10" aria-label="Memuat halaman" role="status">
      <div className="skeleton mb-6 h-10 w-48" />
      <div className="skeleton h-60 w-full" />
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
