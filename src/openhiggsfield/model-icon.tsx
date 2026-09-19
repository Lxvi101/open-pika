import type { CSSProperties } from "react";

/** Brand file in /public/model-icons, or nothing if the pack has no match.
    Ids are catalog model slugs, so a family is recognised by how it starts. */
const FAMILIES: ReadonlyArray<[prefix: string, file: string]> = [
  ["kling", "kling"],
  ["wan", "wan"],
  ["flux", "flux"],
  ["grok", "grok"],
  ["happyhorse", "happy-horse"],
  ["minimax", "minimax"],
  ["hailuo", "minimax"],
  ["h3", "minimax"],
  ["recraft", "recraft"],
  ["ideogram", "ideogram"],
  ["qwen", "qwen"],
];

export function modelIconFile(id: string): string | undefined {
  return FAMILIES.find(([prefix]) => id.startsWith(prefix))?.[1];
}

export function modelIconSrc(id: string): string | undefined {
  const file = modelIconFile(id);
  return file ? `/model-icons/${file}.svg` : undefined;
}

export function ModelIcon({
  modelId,
  size = 16,
  className = "ohf-model-icon",
}: {
  modelId: string;
  size?: number;
  className?: string;
}) {
  const src = modelIconSrc(modelId);
  if (!src) return null;
  return (
    <span
      className={className}
      aria-hidden
      style={
        {
          width: size,
          height: size,
          "--ohf-model-icon": `url("${src}")`,
        } as CSSProperties
      }
    />
  );
}
