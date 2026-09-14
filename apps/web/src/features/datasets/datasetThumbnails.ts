import type { DatasetRecord } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";

export const THUMBNAIL_TEXT_LIMIT = 4000;
const localText = new Map<string, string>();

function key(dataset: DatasetRecord) {
  return `${useResumeStore.getState().user?.id}:${dataset.id}:${dataset.created_at}:${dataset.content_revision??"0"}`;
}

export function getLocalThumbnail(dataset: DatasetRecord) {
  return localText.get(key(dataset));
}

export async function rememberTextThumbnail(dataset: DatasetRecord, file: File) {
  if (!["md", "txt"].includes(dataset.file_format.toLowerCase())) return;
  const cacheKey = key(dataset);
  try {
    const text = await file.slice(0, THUMBNAIL_TEXT_LIMIT * 4).text();
    if (localText.size >= 100) localText.delete(localText.keys().next().value!);
    localText.set(cacheKey, text.slice(0, THUMBNAIL_TEXT_LIMIT));
  } catch {
    // Local preview is optional; the server result remains authoritative.
  }
}
