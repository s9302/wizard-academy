// Graphics quality, chosen in the pause panel and remembered in this browser.
// "high": sharper shadows, clouds, grass and pebbles. "low": for slower
// laptops. The game plays the same either way.

export type Quality = "high" | "low";

const KEY = "wa.quality";

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "high" || saved === "low") return saved;
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
