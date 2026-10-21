export const SEARCH_SORTS = ["relevan", "terbaru", "termurah", "rating"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const SEARCH_PAGE_SIZE = 20;

// Keeps letters and digits only, so user input never reaches tsquery syntax.
export function searchTerms(query: string) {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((term) => term.slice(0, 40));
  return [...new Set(terms)].slice(0, 8);
}
// Prefix matching lets "kame" find "kamera" while typing.
export function prefixQuery(terms: string[]) {
  return terms.map((term) => `${term}:*`).join(" & ");
}
export function defaultSort(query: string | undefined): SearchSort {
  return query && searchTerms(query).length ? "relevan" : "terbaru";
}
