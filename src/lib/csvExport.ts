/**
 * CSV export for admin tables.
 *
 * Building the file by hand avoids a dependency for what is, in the end, a
 * join of quoted fields. Two details matter more than the joining:
 *
 *  - a value containing a quote, comma or newline has to be quoted, and inner
 *    quotes doubled, or the sheet opens with the columns shifted;
 *  - a leading `=`, `+`, `-` or `@` makes a spreadsheet treat the cell as a
 *    formula. Account names come from OAuth profiles, so a display name of
 *    `=cmd|...` is a real (if unlikely) input, not a hypothetical.
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

/** One CSV line: fields quoted only when they need it. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row + one line per item, CRLF terminated (what Excel expects). */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(c.value(row))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Hand the CSV to the browser as a download. Returns false when there is no
 * DOM to do it in, so a caller can report a failure instead of silently
 * doing nothing.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof document === "undefined") return false;
  // The BOM makes Excel read the file as UTF-8; without it, accented names
  // come out as mojibake.
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
