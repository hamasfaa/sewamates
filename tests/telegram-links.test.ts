import { describe, expect, it } from "vitest";
import { telegramLoginLinks } from "@/src/lib/telegram-links";

describe("Tautan login Telegram", () => {
  it("membuka aplikasi dan Telegram Web dengan token permintaan yang sama", () => {
    const token = "login_test-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const links = telegramLoginLinks(`https://t.me/SewaMatesDevBot?start=${token}`);
    const appUrl = new URL(links.appLink);
    expect(appUrl.protocol).toBe("tg:");
    expect(appUrl.hostname).toBe("resolve");
    expect(appUrl.searchParams.get("domain")).toBe("SewaMatesDevBot");
    expect(appUrl.searchParams.get("start")).toBe(token);
    const webUrl = new URL(links.webLink);
    expect(webUrl.origin).toBe("https://web.telegram.org");
    expect(webUrl.pathname).toBe("/k/");
    expect(new URLSearchParams(webUrl.hash.slice(2)).get("tgaddr")).toBe(links.appLink);
  });
  it.each([
    "https://attacker.example/SewaMatesDevBot?start=example",
    "http://t.me/SewaMatesDevBot?start=example",
    "https://t.me/SewaMatesDevBot",
    "https://t.me/SewaMatesDevBot?start=" + "a".repeat(65),
    "https://t.me/SewaMatesDevBot?start=example%26other%3Dvalue",
  ])("menolak tautan dengan host atau token yang tidak valid: %s", (link) => {
    expect(() => telegramLoginLinks(link)).toThrow("Tautan login tidak valid");
  });
});
