const EMAIL_ADDRESS_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

/** Email addresses are resume contact text, not styled document links. */
export function isResumeEmailLink(value: string) {
  const normalized = value.trim();
  if (/^mailto:/i.test(normalized)) return true;
  return EMAIL_ADDRESS_PATTERN.test(normalized);
}

export function shouldAutoLinkResumeValue(value: string) {
  return !isResumeEmailLink(value);
}
