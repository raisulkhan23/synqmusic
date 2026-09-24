const DATABASE_NAME = "soniq-wallpapers";
const DATABASE_VERSION = 1;
const STORE_NAME = "files";
export const LIVE_WALLPAPER_KEY = "live-wallpaper";
export const LIVE_WALLPAPER_MARKER = "idb:live-wallpaper";

type StoredWallpaper = {
  key: string;
  blob: Blob;
  name: string;
  type: string;
};

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open wallpaper storage"));
  });

export async function saveLiveWallpaperFile(file: File): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: LIVE_WALLPAPER_KEY,
        blob: file,
        name: file.name,
        type: file.type,
      } satisfies StoredWallpaper);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save wallpaper file"));
    });
  } finally {
    database.close();
  }
}

export async function getLiveWallpaperUrl(): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const record = await new Promise<StoredWallpaper | undefined>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(LIVE_WALLPAPER_KEY);
      request.onsuccess = () => resolve(request.result as StoredWallpaper | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read wallpaper file"));
    });
    return record?.blob ? URL.createObjectURL(record.blob) : null;
  } finally {
    database.close();
  }
}

export async function deleteLiveWallpaperFile(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(LIVE_WALLPAPER_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove wallpaper file"));
    });
  } finally {
    database.close();
  }
}
