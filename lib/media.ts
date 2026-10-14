export const IMAGE_FILE_PATTERN = /^image\//i;

export function splitMediaValue(value: unknown) {
  if (value === null || value === undefined) {
    return [];
  }

  return String(value)
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// data:, http(s), and root-relative demo paths all render directly in <img src>.
export function resolveDisplayImageUrl(value?: string) {
  return value?.trim() ?? "";
}

export function toDisplayMediaUrl(value: string, mediaBaseUrl: string) {
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const uploadPath = normalizeUploadDisplayPath(trimmed);
  if (uploadPath && mediaBaseUrl) {
    return new URL(uploadPath.replace(/^\/+/, ""), mediaBaseUrl).toString();
  }

  // Same-origin assets (e.g. /demo-goods/pack-01.jpg) render as-is.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  return "";
}

function normalizeUploadDisplayPath(value: string) {
  const normalized = value.replace(/^\/+upload\//i, "/upload/");
  return normalized.startsWith("/upload/") ? normalized : "";
}
