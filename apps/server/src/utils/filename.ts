const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAILING_DOTS_SPACES = /[. ]+$/g;
const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeWindowsFilenameBase(
  input: string,
  options?: { fallback?: string; maxLength?: number }
): string {
  const fallback = options?.fallback ?? "video";
  const maxLength = options?.maxLength ?? 80;

  const raw = String(input ?? "");
  let base = raw
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TRAILING_DOTS_SPACES, "")
    .trim();

  if (base.length > maxLength) {
    base = base.slice(0, maxLength).trim().replace(TRAILING_DOTS_SPACES, "").trim();
  }

  if (!base) {
    base = fallback;
  }

  if (RESERVED_WINDOWS_NAMES.test(base)) {
    const suffix = "-video";
    const room = Math.max(1, maxLength - suffix.length);
    const trimmed = base.slice(0, room).trim().replace(TRAILING_DOTS_SPACES, "").trim();
    base = `${trimmed}${suffix}`;
  }

  return base;
}

