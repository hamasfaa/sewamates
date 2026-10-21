"use client";
import { useCallback, useEffect, useState } from "react";
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const mutation = init?.method && !["GET", "HEAD"].includes(init.method);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(mutation
        ? { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || "Permintaan belum berhasil. Coba lagi sebentar.");
  return result as T;
}
export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setError("");
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setError(error.message);
      });
    return () => controller.abort();
  }, [url, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading: !data && !error, reload };
}
