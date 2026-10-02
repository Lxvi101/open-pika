export type LipSyncReference = {
  mode: "audio" | "video";
  url: string;
  duration: number;
  transcript: string;
  aspectRatio?: string;
};

export const LIP_SYNC_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

export function validClipDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 4 && value <= 30;
}
