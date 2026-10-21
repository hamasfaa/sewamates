"use client";
import { useState } from "react";
import { filterCampuses, type CampusOption } from "@/src/domain/campuses";
import { Input } from "./ui/input";

export function CampusSelect({
  campuses,
  value,
  onChange,
}: {
  campuses: CampusOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const available = campuses.filter((campus) => campus.isActive);
  const matches = filterCampuses(available, query);
  const selected = campuses.find((campus) => campus.id === value);
  const keepSelected = selected && !matches.some((campus) => campus.id === selected.id);

  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor="campus">
        Kampus
      </label>
      <Input
        type="search"
        aria-label="Cari kampus"
        aria-controls="campus"
        aria-describedby="campus-results"
        placeholder="Cari nama atau singkatan kampus"
        value={query}
        maxLength={100}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2"
      />
      <select
        className="input w-full min-w-0"
        id="campus"
        name="campusId"
        value={value}
        required
        onChange={(event) => onChange(event.target.value)}
        aria-describedby="campus-results"
      >
        <option value="">Pilih kampusmu</option>
        {keepSelected && <option value={selected.id}>{selected.name} (pilihan saat ini)</option>}
        {matches.map((campus) => (
          <option key={campus.id} value={campus.id}>
            {campus.name}
          </option>
        ))}
      </select>
      <p className="help" id="campus-results" role="status">
        {!available.length
          ? "Daftar kampus belum tersedia. Coba muat ulang sebentar lagi."
          : !matches.length
            ? "Kampus belum ditemukan. Coba nama atau singkatan lain."
            : `${matches.length} kampus tersedia. Pilih yang sesuai dengan kampusmu.`}
      </p>
      {selected && !selected.isActive && (
        <p className="help">Kampus sebelumnya sudah diarsipkan. Kamu bisa memilih kampus baru.</p>
      )}
    </div>
  );
}
