// Graphics quality, chosen in the pause panel and remembered in this browser.
// "ultra": everything in "high", plus post-processing (bloom, ambient
// occlusion, filmic color), soft 4K shadows, torchlight and more particles.
// "high": surface detail, clouds, grass and pebbles. "low": for slower
// laptops. The game plays the same either way.

export type Quality = "ultra" | "high" | "low";
export const QUALITIES: Quality[] = ["low", "high", "ultra"];
export const QUALITY_NAMES: Record<Quality, string> = { low: "Low", high: "High", ultra: "Ultra" };

const KEY = "wa.quality";

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "high" || saved === "low" || saved === "ultra") return saved;
  } catch {
    // storage blocked: use the default
  }
  // Phones and small screens start on low.
  return matchMedia("(pointer: coarse)").matches ? "low" : "high";
}

export function setQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // not remembered, but still used for this visit
  }
  current = q;
}

let current: Quality | null = null;
export function quality(): Quality {
  return (current ??= getQuality());
}

// At least "high" (detail, decor, clouds).
export const fancy = (): boolean => quality() !== "low";
export const ultra = (): boolean => quality() === "ultra";
