"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, PackageSearch, Search, SlidersHorizontal, X } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { CampusOption } from "@/src/domain/campuses";
import type { ItemCardData } from "@/src/services/search-service";
import { cn, dateOnlyWib, rupiah } from "@/src/lib/utils";
import { CampusSelect } from "./campus-select";
import { ItemCard, ItemCardSkeleton } from "./item-card";
import { MoneyInput } from "./money-input";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type SearchFilters = {
  q: string;
  category: string;
  campus: string;
  point: string;
  min: number | null;
  max: number | null;
  from: string;
  to: string;
  sort: string;
};
type Results = { items: ItemCardData[]; nextCursor: string | null; sort: string };
type Option = { id: string; name: string };
const SORTS = [
  ["relevan", "Paling relevan"],
  ["terbaru", "Terbaru"],
  ["termurah", "Harga termurah"],
  ["rating", "Rating tertinggi"],
] as const;

function apiQuery(filters: SearchFilters, cursor?: string) {
  const params = new URLSearchParams();
  for (const key of ["q", "category", "campus", "point", "from", "to", "sort"] as const)
    if (filters[key]) params.set(key, filters[key]);
  if (filters.min !== null) params.set("min", String(filters.min));
  if (filters.max !== null) params.set("max", String(filters.max));
  if (cursor) params.set("cursor", cursor);
  return params;
}
// "campus=semua" keeps an explicit all-campus choice when the default is the user's campus.
function pageUrl(filters: SearchFilters, defaultCampus: string) {
  const params = apiQuery(filters);
  params.delete("campus");
  if (filters.campus !== defaultCampus) params.set("campus", filters.campus || "semua");
  return params.size ? `/cari?${params}` : "/cari";
}

export function SearchView({
  initial,
  defaultCampus,
}: {
  initial: SearchFilters;
  defaultCampus: string;
}) {
  const [filters, setFilters] = useState(initial),
    [draft, setDraft] = useState(initial),
    [results, setResults] = useState<Results | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [sheet, setSheet] = useState(false),
    [points, setPoints] = useState<{ campus: string; list: Option[] }>({ campus: "", list: [] });
  const categories = useApi<Option[]>("/api/categories"),
    campuses = useApi<CampusOption[]>("/api/campuses");
  const sentinel = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    filterButton = useRef<HTMLButtonElement>(null);

  function apply(next: SearchFilters) {
    setFilters(next);
    setDraft(next);
    setLoading(true);
    setError("");
    setSheet(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    window.history.replaceState(null, "", pageUrl(filters, defaultCampus));
    api<Results>(`/api/items?${apiQuery(filters)}`, { signal: controller.signal })
      .then((value) => {
        setResults(value);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [filters, defaultCampus]);
  useEffect(() => {
    if (!draft.campus) return;
    const controller = new AbortController();
    api<Option[]>(`/api/pickup-points?campus=${draft.campus}`, { signal: controller.signal })
      .then((list) => setPoints({ campus: draft.campus, list }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [draft.campus]);
  const loadMore = useCallback(async () => {
    const cursor = results?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api<Results>(`/api/items?${apiQuery(filters, cursor)}`);
      // Ignore a late page if the filters changed meanwhile.
      setResults((current) =>
        current?.nextCursor === cursor
          ? { ...next, items: [...current.items, ...next.items] }
          : current,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [results, loadingMore, filters]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !results?.nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "480px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [results?.nextCursor, loadMore]);
  useEffect(() => {
    if (!sheet) return;
    const button = filterButton.current;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(false);
    };
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, select")?.focus();
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
      button?.focus();
    };
  }, [sheet]);

  const categoryName = categories.data?.find((row) => row.id === filters.category)?.name;
  const campusName = campuses.data?.find((row) => row.id === filters.campus)?.name;
  const pointName = points.list.find((row) => row.id === filters.point)?.name;
  const chips = [
    filters.campus && {
      label: campusName || "Kampus dipilih",
      clear: { campus: "", point: "" },
    },
    filters.category && { label: categoryName || "Kategori", clear: { category: "" } },
    filters.point && { label: pointName || "Titik serah terima", clear: { point: "" } },
    (filters.min !== null || filters.max !== null) && {
      label:
        filters.min !== null && filters.max !== null
          ? `${rupiah(filters.min)}–${rupiah(filters.max)}`
          : filters.min !== null
            ? `Mulai ${rupiah(filters.min)}`
            : `Sampai ${rupiah(filters.max!)}`,
      clear: { min: null, max: null },
    },
    (filters.from || filters.to) && {
      label:
        filters.from && filters.to && filters.from !== filters.to
          ? `${dateOnlyWib(filters.from)} – ${dateOnlyWib(filters.to)}`
          : `Tersedia ${dateOnlyWib(filters.from || filters.to)}`,
      clear: { from: "", to: "" },
    },
  ].filter(Boolean) as { label: string; clear: Partial<SearchFilters> }[];
  const reset = {
    ...initial,
    q: filters.q,
    category: "",
    campus: "",
    point: "",
    min: null,
    max: null,
    from: "",
    to: "",
  };

  return (
    <div className="page-container py-6 lg:py-10">
      <form
        role="search"
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ ...filters, q: draft.q.trim(), sort: "" });
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            aria-label="Kata kunci"
            placeholder="Mau pinjam apa hari ini?"
            maxLength={100}
            className="rounded-full pl-11"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </div>
        <Button type="submit" className="shrink-0">
          Cari
        </Button>
      </form>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside
          ref={panel}
          className={cn(
            "lg:block",
            sheet
              ? "fixed inset-0 z-50 flex items-end bg-[rgba(11,31,77,0.45)] lg:static lg:z-auto lg:bg-transparent"
              : "hidden",
          )}
          {...(sheet
            ? { role: "dialog", "aria-modal": true, "aria-labelledby": "filter-title" }
            : {})}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSheet(false);
          }}
        >
          <form
            className="form-stack max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)] lg:sticky lg:top-24 lg:max-h-none lg:overflow-visible lg:rounded-2xl lg:border lg:border-border lg:card-shadow"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ ...draft, q: filters.q, sort: filters.sort });
            }}
          >
            <div className="flex items-center justify-between">
              <h2 id="filter-title" className="text-lg">
                Filter
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Tutup filter"
                onClick={() => setSheet(false)}
              >
                <X size={20} />
              </Button>
            </div>
            {campuses.data ? (
              <CampusSelect
                id="filter-campus"
                campuses={campuses.data}
                value={draft.campus}
                emptyLabel="Semua kampus"
                required={false}
                onChange={(campus) => setDraft({ ...draft, campus, point: "" })}
              />
            ) : (
              <div className="skeleton h-28" role="status" aria-label="Memuat kampus" />
            )}
            <div>
              <label className="field-label" htmlFor="filter-category">
                Kategori
              </label>
              <select
                id="filter-category"
                className="input"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              >
                <option value="">Semua kategori</option>
                {categories.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="filter-point">
                Titik serah terima
              </label>
              <select
                id="filter-point"
                className="input"
                value={draft.point}
                disabled={!draft.campus}
                onChange={(event) => setDraft({ ...draft, point: event.target.value })}
              >
                <option value="">Semua titik</option>
                {(points.campus === draft.campus ? points.list : []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              {!draft.campus && <p className="help">Pilih kampus untuk memilih titik.</p>}
            </div>
            <fieldset>
              <legend className="field-label">Harga per hari</legend>
              <div className="grid grid-cols-2 gap-2">
                <MoneyInput
                  aria-label="Harga minimum"
                  placeholder="Min"
                  value={draft.min}
                  onChange={(min) => setDraft({ ...draft, min })}
                />
                <MoneyInput
                  aria-label="Harga maksimum"
                  placeholder="Maks"
                  value={draft.max}
                  onChange={(max) => setDraft({ ...draft, max })}
                />
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label">Tersedia pada tanggal</legend>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="Mulai tanggal"
                  value={draft.from}
                  onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                />
                <Input
                  type="date"
                  aria-label="Sampai tanggal"
                  value={draft.to}
                  min={draft.from || undefined}
                  onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                />
              </div>
              <p className="help">Barang yang diblokir pemilik pada tanggal itu disembunyikan.</p>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="flex-1">
                Terapkan filter
              </Button>
              <Button type="button" variant="ghost" onClick={() => apply(reset)}>
                Reset
              </Button>
            </div>
          </form>
        </aside>
        <section className="min-w-0" aria-labelledby="results-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h1 id="results-title" className="min-w-0 text-xl sm:text-2xl">
              {filters.q ? `Hasil untuk “${filters.q}”` : "Barang dari teman kampus"}
            </h1>
            <div className="flex items-center gap-2">
              <Button
                ref={filterButton}
                type="button"
                variant="outline"
                size="sm"
                className="lg:hidden"
                aria-expanded={sheet}
                onClick={() => setSheet(true)}
              >
                <SlidersHorizontal size={16} />
                Filter{chips.length ? ` (${chips.length})` : ""}
              </Button>
              <label className="sr-only" htmlFor="sort">
                Urutkan
              </label>
              <select
                id="sort"
                className="input min-h-11 w-auto rounded-full py-2 text-sm"
                value={results?.sort || filters.sort || (filters.q ? "relevan" : "terbaru")}
                onChange={(event) => apply({ ...filters, sort: event.target.value })}
              >
                {SORTS.filter(([value]) => value !== "relevan" || filters.q).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
          {chips.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-2" aria-label="Filter aktif">
              {chips.map((chip) => (
                <li key={chip.label}>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-bold text-secondary-foreground hover:bg-border"
                    onClick={() => apply({ ...filters, ...chip.clear })}
                    aria-label={`Hapus filter ${chip.label}`}
                  >
                    {chip.label}
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="notice notice-error mb-4" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <div
              className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4"
              role="status"
              aria-label="Memuat barang"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <ItemCardSkeleton key={i} />
              ))}
            </div>
          ) : results?.items.length ? (
            <>
              <ul
                className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4"
                aria-label="Hasil pencarian"
              >
                {results.items.map((item) => (
                  <li key={item.id} className="flex min-w-0">
                    <ItemCard item={item} className="w-full" />
                  </li>
                ))}
              </ul>
              <div ref={sentinel} className="mt-6 flex justify-center">
                {results.nextCursor ? (
                  <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore && <LoaderCircle size={16} className="animate-spin" />}
                    {loadingMore ? "Memuat…" : "Muat lebih banyak"}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Sudah sampai ujung daftar.</p>
                )}
              </div>
            </>
          ) : (
            !error && (
              <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
                <PackageSearch size={40} className="mx-auto mb-4 text-primary" />
                <h2 className="text-lg">Barang belum ditemukan</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Coba kata kunci lain, kurangi filter, atau pilih semua kampus.
                </p>
                {chips.length > 0 && (
                  <Button variant="outline" className="mt-5" onClick={() => apply(reset)}>
                    Hapus semua filter
                  </Button>
                )}
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
