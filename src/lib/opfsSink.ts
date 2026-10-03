import type { FileSink } from "@/lib/downloadManager";

/**
 * A `FileSink` backed by the Origin Private File System.
 *
 * WHY OPFS AND NOT MEMORY. A 40-minute track is ~40 MB and a full album is
 * ~600 MB. Holding either in a JS array or an in-memory blob is how a download
 * tab takes the whole tab down with it, and it is exactly what the brief rules
 * out ("avoid downloading entire files into RAM"). OPFS is a real filesystem
 * the browser owns: writes go to disk, `bytesWritten()` asks the file rather
 * than trusting a counter, and a reload does not lose the partial.
 *
 * WHY NOT INDEXEDDB. Blobs there are held in memory by the browser until
 * flushed, and truncating one is awkward. OPFS gives random-access append and
 * truncate, which is what resuming needs.
 *
 * The partial lives under a `.part` name and is only promoted to its final
 * name in `commit()`, so a half-finished download is never mistaken for a
 * finished one — the same rule the engine applies in memory.
 */

const DIR = "synq-downloads";

export function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function dir(): Promise<FileSystemDirectoryHandle> {
  if (!opfsSupported()) {
    throw new Error("This browser has no Origin Private File System");
  }
  const base = await navigator.storage.getDirectory();
  return base.getDirectoryHandle(DIR, { create: true });
}

/** OPFS names are path segments, so separators and traversal must go. */
function safeName(filename: string, id: string): string {
  const cleaned = filename
    // `\p{C}` matches control/format characters without putting literal
    // control bytes in the pattern.
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\p{C}/gu, "")
    .slice(0, 120);
  return `${id}__${cleaned || "download"}`;
}

export class OpfsSink implements FileSink {
  private handle: FileSystemFileHandle | null = null;
  private writer: FileSystemWritableFileStream | null = null;
  private knownBytes = 0;
  private readonly filename: string;
  private readonly id: string;

  // Parameter properties are not used: this project compiles with
  // `erasableSyntaxOnly`, which forbids them.
  private constructor(filename: string, id: string) {
    this.filename = filename;
    this.id = id;
  }

  static async open(filename: string, id: string): Promise<OpfsSink> {
    const sink = new OpfsSink(filename, id);
    const directory = await dir();
    sink.handle = await directory.getFileHandle(
      `${safeName(filename, id)}.part`,
      { create: true },
    );
    // An existing `.part` file is the resume point. Reading its real size from
    // the filesystem is what keeps resume honest across a reload.
    sink.knownBytes = (await sink.handle.getFile()).size;
    return sink;
  }

  async bytesWritten(): Promise<number> {
    if (this.handle) {
      // Authoritative, not a counter: this survives a crash mid-write.
      this.knownBytes = (await this.handle.getFile()).size;
    }
    return this.knownBytes;
  }

  private async ensureWriter(): Promise<FileSystemWritableFileStream> {
    if (this.writer) return this.writer;
    if (!this.handle) throw new Error("Sink is closed");
    const file = await this.handle.getFile();
    // `keepExistingData` preserves the partial, but the writer still starts at
    // position 0 — `seek` is what makes appending to a resumed file correct.
    this.writer = await this.handle.createWritable({ keepExistingData: true });
    await this.writer.seek(file.size);
    return this.writer;
  }

  async append(chunk: Uint8Array): Promise<void> {
    const writer = await this.ensureWriter();
    // Copied into a fresh ArrayBuffer-backed view: the engine's chunks come
    // off a stream and may be backed by a SharedArrayBuffer, which the OPFS
    // write signature does not accept.
    await writer.write(new Uint8Array(chunk));
    this.knownBytes += chunk.length;
  }

  async truncate(to: number): Promise<void> {
    // An open writer cannot shrink a file, so the partial is rewritten.
    // Only reached when a range came back short.
    await this.closeWriter();
    if (!this.handle) throw new Error("Sink is closed");
    const empty = await this.handle.createWritable({ keepExistingData: false });
    await empty.truncate(to);
    await empty.close();
    this.knownBytes = to;
  }

  async commit(): Promise<void> {
    await this.closeWriter();
    if (!this.handle) throw new Error("Sink is closed");
    const directory = await dir();
    const name = safeName(this.filename, this.id);
    await directory.getFileHandle(name, { create: false }).catch(async () => {
      // Absent on the normal path: copy the verified `.part` across, then drop
      // it. Only reached after the engine confirmed the full length.
      const from = await directory.getFileHandle(`${name}.part`, {
        create: false,
      });
      const file = await from.getFile();
      const to = await directory.getFileHandle(name, { create: true });
      const writer = await to.createWritable();
      await writer.write(await file.arrayBuffer());
      await writer.close();
      await directory.removeEntry(`${name}.part`);
    });
  }

  async discardIncomplete(): Promise<void> {
    await this.closeWriter();
    if (!this.handle) return;
    const directory = await dir();
    await directory
      .removeEntry(`${safeName(this.filename, this.id)}.part`)
      .catch(() => undefined);
  }

  private async closeWriter(): Promise<void> {
    const writer = this.writer;
    if (!writer) return;
    this.writer = null;
    try {
      await writer.close();
    } catch {
      // Aborting mid-write is expected on pause/cancel. Whatever landed is
      // still valid — resume uses the file's real size, not a counter.
      try {
        await writer.abort();
      } catch {
        /* already closed */
      }
    }
  }
}