export type CampusOption = {
  id: string;
  name: string;
  domains: string[];
  isActive: boolean;
};

export function normalizeCampusSearch(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function filterCampuses<T extends Pick<CampusOption, "name" | "domains">>(
  campuses: T[],
  query: string,
) {
  const search = normalizeCampusSearch(query);
  const terms = search.split(/\s+/).filter(Boolean);
  const matches = campuses.filter((campus) => {
    const text = normalizeCampusSearch([campus.name, ...campus.domains].join(" "));
    return terms.every((term) => text.includes(term));
  });
  // Prioritize exact abbreviations (ITS -> its.ac.id) over incidental substrings.
  const rank = (campus: T) => {
    if (normalizeCampusSearch(campus.name) === search) return 0;
    if (campus.domains.some((domain) => domain.split(".")[0].toLowerCase() === search)) return 1;
    return 2;
  };
  return search ? matches.sort((a, b) => rank(a) - rank(b)) : matches;
}

// Compact label from the primary domain for cards: its.ac.id → ITS.
export function campusLabel(campus: Pick<CampusOption, "name" | "domains">) {
  return campus.domains[0]?.split(".")[0]?.toUpperCase() || campus.name;
}
