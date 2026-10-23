import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  e2eDatabaseUrl,
  e2eAppUrl,
  storageUrl,
  testAccountKey,
  testStorageKey,
} from "./transactions-env";

const objects = new Map<string, { bytes: Buffer; type: string }>();
const tokens = new Map<string, { path: string; expires: number; upload: boolean }>();
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const storage = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", e2eAppUrl);
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url || "/", storageUrl);
  const upload = url.pathname.includes("/object/upload/sign/");
  const sign = url.pathname.includes("/object/sign/");
  const path = decodeURIComponent(
    url.pathname.replace(
      /^\/storage\/v1\/object\/(upload\/sign\/|sign\/|authenticated\/|public\/)?/,
      "",
    ),
  );
  const server = req.headers.authorization === `Bearer ${testStorageKey}`;
  const json = (value: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  };
  if (req.method === "POST" && server && (upload || sign)) {
    const token = randomUUID();
    tokens.set(token, { path, expires: Date.now() + 300000, upload });
    json(
      upload
        ? { url: `/object/upload/sign/${path}?token=${token}` }
        : { signedURL: `/object/sign/${path}?token=${token}` },
    );
    return;
  }
  const token = tokens.get(url.searchParams.get("token") || "");
  const allowed = token?.path === path && token.expires > Date.now();
  if (req.method === "PUT" && upload && allowed && token?.upload) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    objects.set(path, {
      bytes: Buffer.concat(chunks),
      type: String(req.headers["content-type"] || "image/png"),
    });
    json({ Key: path });
    return;
  }
  if (
    req.method === "GET" &&
    (server || (allowed && !token?.upload) || path.startsWith("items-public/"))
  ) {
    const object =
      objects.get(path) ||
      (path.startsWith("items-public/") ? { bytes: image, type: "image/png" } : undefined);
    if (object) {
      res.setHeader("Content-Type", object.type);
      res.end(object.bytes);
      return;
    }
  }
  res.statusCode = 403;
  json({ statusCode: "403", error: "Forbidden", message: "Private test object" });
});
await new Promise<void>((resolve) => storage.listen(3101, "127.0.0.1", resolve));
const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl(),
      DIRECT_DATABASE_URL: "",
      NEXT_PUBLIC_APP_URL: e2eAppUrl,
      SUPABASE_URL: storageUrl,
      SUPABASE_SERVICE_ROLE_KEY: testStorageKey,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_BOT_USERNAME: "SewaMatesDevBot",
      TELEGRAM_WEBHOOK_SECRET: "",
      TELEGRAM_ADMIN_CHAT_ID: "",
      INTERNAL_JOB_SECRET: "local-e2e-job-only",
      ACCOUNT_ENCRYPTION_KEY: testAccountKey,
      NEXT_PUBLIC_SENTRY_DSN: "",
      SENTRY_AUTH_TOKEN: "",
      SENTRY_ORG: "",
      SENTRY_PROJECT: "",
    },
  },
);
next.on("exit", (code) => {
  storage.close();
  process.exit(code || 0);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    next.kill(signal);
    storage.close();
  });
