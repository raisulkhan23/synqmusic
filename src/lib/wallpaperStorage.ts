const DATABASE_NAME = "soniq-wallpapers";
const DATABASE_VERSION = 1;
const STORE_NAME = "files";
export const LIVE_WALLPAPER_KEY = "live-wallpaper";
export const IMAGE_WALLPAPER_KEY = "image-wallpaper";
export const LIVE_WALLPAPER_MARKER = "idb:live-wallpaper";
export const IMAGE_WALLPAPER_MARKER = "idb:image-wallpaper";

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

async function saveWallpaperFile(key: string, file: File): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key,
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

async function getWallpaperUrl(key: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const record = await new Promise<StoredWallpaper | undefined>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => resolve(request.result as StoredWallpaper | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read wallpaper file"));
    });
    return record?.blob ? URL.createObjectURL(record.blob) : null;
  } finally {
    database.close();
  }
}

async function deleteWallpaperFile(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove wallpaper file"));
    });
  } finally {
    database.close();
  }
}

export const saveLiveWallpaperFile = (file: File) => saveWallpaperFile(LIVE_WALLPAPER_KEY, file);
export const saveImageWallpaperFile = (file: File) => saveWallpaperFile(IMAGE_WALLPAPER_KEY, file);
export const getLiveWallpaperUrl = () => getWallpaperUrl(LIVE_WALLPAPER_KEY);
export const getImageWallpaperUrl = () => getWallpaperUrl(IMAGE_WALLPAPER_KEY);
export const deleteLiveWallpaperFile = () => deleteWallpaperFile(LIVE_WALLPAPER_KEY);
export const deleteImageWallpaperFile = () => deleteWallpaperFile(IMAGE_WALLPAPER_KEY);
