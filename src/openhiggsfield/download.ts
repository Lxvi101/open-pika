import type { RunRecord } from "./history";

/* Result media is served from the platform's own CDN, so an <a download>
   pointed at it is ignored — the attribute only names a file when the href is
   same-origin. The bytes have to be read first, which means the CDN's CORS
   policy decides whether a run can be saved at all. A refusal is reported
   rather than papered over with a new tab the popup blocker would eat. */
export async function saveFile(url: string, name: string): Promise<boolean> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return false;
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
    /* Revoking on the next tick races Safari, which reads the blob after the
       click returns. The handle costs nothing until then. */
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    return false;
  }
}

/** Words are already in hand, so saving them needs no read and cannot be
    refused. */
export function saveText(text: string, name: string): void {
  const href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const FALLBACK_EXT = { image: "png", video: "mp4", audio: "mp3", text: "txt" } as const;

/** A saved run has to be findable in a downloads folder six months later, so
    the name carries the prompt rather than the platform's request id. */
export function fileNameFor(record: RunRecord, index: number): string {
  const url = record.kind === "text" ? "" : (record.urls[0] ?? "");
  const ext = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  const slug =
    record.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 44)
      .replace(/-+$/, "") || "run";
  return `openpika-${slug}-${index + 1}.${ext ?? FALLBACK_EXT[record.kind]}`;
}
