// These fixtures deliberately refuse hosted databases, even if .env.local is present.
export function e2eDatabaseUrl() {
  const value = process.env.E2E_DATABASE_URL;
  if (!value) throw new Error("Isi E2E_DATABASE_URL ke PostgreSQL lokal bernama sewamates_e2e.");
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/sewamates_e2e"
  )
    throw new Error(
      "E2E hanya diizinkan pada database loopback sewamates_e2e yang boleh dikosongkan.",
    );
  return value;
}
export const e2eAppUrl = "http://localhost:3100";
export const storageUrl = "http://127.0.0.1:3101";
export const testStorageKey = "local-e2e-storage-only";
