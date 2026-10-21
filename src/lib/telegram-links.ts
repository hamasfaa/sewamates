export function telegramLoginLinks(deepLink: string) {
  const url = new URL(deepLink);
  const username = url.pathname.slice(1);
  const token = url.searchParams.get("start") || "";
  if (
    url.origin !== "https://t.me" ||
    !/^[A-Za-z0-9_]{5,32}$/.test(username) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(token)
  ) {
    throw new Error("Tautan login tidak valid. Buat permintaan login baru.");
  }
  const appLink = `tg://resolve?${new URLSearchParams({ domain: username, start: token })}`;
  return {
    appLink,
    webLink: `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(appLink)}`,
  };
}
