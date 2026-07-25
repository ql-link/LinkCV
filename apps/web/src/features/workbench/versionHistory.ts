import type { JSONContent } from "@tiptap/core";

export type VersionSnapshot = {
  id: string;
  label: "自动保存" | "手动保存";
  time: string;
  json: JSONContent;
};

const DATABASE_NAME = "linkcv-workbench";
const STORE_NAME = "resume-versions";
const DATABASE_VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}
export async function loadVersionHistory(resumeId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<VersionSnapshot[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(resumeId);
      request.addEventListener("success", () => resolve(Array.isArray(request.result) ? request.result : []));
      request.addEventListener("error", () => reject(request.error));
    });
  } finally {
    database.close();
  }
}

export async function saveVersionHistory(resumeId: string, versions: VersionSnapshot[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(versions.slice(0, 20), resumeId);
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  } finally {
    database.close();
  }
}
