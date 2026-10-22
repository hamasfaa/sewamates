// Keep original evidence in the database; only return the redacted text to participants.
export function redactChat(body: string) {
  let redacted = false;
  const hide = () => {
    redacted = true;
    return "•••• (disembunyikan)";
  };
  const text = body
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi, hide)
    .replace(/\+?\d(?:[\s().-]*\d){7,}/g, hide);
  return { text, redacted };
}
