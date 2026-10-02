import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validClipDuration } from "./types";

// Each frame clears Seedance's 407,696-pixel minimum and has an exact ratio.
export const carrierSizes: Record<string, string> = {
  "16:9": "1024x576", "9:16": "576x1024", "1:1": "640x640",
  "4:3": "768x576", "3:4": "576x768", "21:9": "1008x432",
};

export async function createVideoCarrier(audio: Uint8Array, duration: number, ratio: string): Promise<Uint8Array> {
  const size = carrierSizes[ratio];
  if (!size || !validClipDuration(duration)) throw new Error("Invalid Pro reference dimensions or duration.");
  const directory = await mkdtemp(join(tmpdir(), "pika-lipsync-"));
  try {
    const input = join(directory, "audio.wav");
    const output = join(directory, "reference.mp4");
    await writeFile(input, audio);
    await promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${size}:r=30:d=${duration}`,
      "-i", input, "-map", "0:v:0", "-map", "1:a:0", "-t", String(duration),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output,
    ], { timeout: 90_000, maxBuffer: 1024 * 1024 });
    return new Uint8Array(await readFile(output));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Pro mode needs FFmpeg on the server. Install it or set FFMPEG_PATH.");
    throw new Error("Could not encode the Pro reference. Check the server's FFmpeg installation.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
