"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client-api";
export function useClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export function useLiveApi<T>(url: string, interval = 1500) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await api<T>(url);
      setData(value);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, [url]);
  useEffect(() => {
    let active = true,
      busy = false;
    const controller = new AbortController();
    const fetchData = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await api<T>(url, { signal: controller.signal });
        if (active) {
          setData(value);
          setError("");
        }
      } catch (error) {
        if (active && (error as Error).name !== "AbortError") setError((error as Error).message);
      } finally {
        busy = false;
      }
    };
    void fetchData();
    const timer = setInterval(() => {
      if (!document.hidden) void fetchData();
    }, interval);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [url, interval]);
  return { data, error, refresh };
}
