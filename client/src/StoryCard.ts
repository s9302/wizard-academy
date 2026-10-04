// The chapter text in the trials: the intro when you arrive, and the ending
// (plus what it unlocked) the first time you clear it. Shown in the middle of
// the screen; it fades once you start running, or after a while.

import type { Chapter } from "../../shared/src/story.ts";
import { unlocksForChapter } from "../../shared/src/unlocks.ts";

const INTRO_MS = 16_000;
const OUTRO_MS = 14_000;
// Starting the run hides the intro, but not before it's had this long (you
// may still be holding W from walking through the portal).
const MIN_SHOWN_MS = 6_000;

export class StoryCard {
  private el: HTMLElement;
  private timer: number | undefined;
  private shownAt = 0;

  constructor(hud: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "story-card";
    hud.appendChild(this.el);
  }

  private show(title: string, lines: string[], footer: string, ms: number): void {
    this.el.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = title;
    this.el.appendChild(h);
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      this.el.appendChild(p);
    }
    if (footer) {
      const f = document.createElement("p");
      f.className = "story-footer";
      f.textContent = footer;
      this.el.appendChild(f);
    }
    this.el.classList.add("show");
    this.shownAt = performance.now();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  intro(chapter: Chapter): void {
    this.show(chapter.title, chapter.intro, "Step off the platform to begin", INTRO_MS);
  }

  outro(chapter: Chapter): void {
    const rewards = unlocksForChapter(chapter.id).map((u) => u.name);
    this.show(`${chapter.title.split(":")[0]} complete!`, chapter.outro, `Unlocked: ${rewards.join(", ")}`, OUTRO_MS);
  }

  hide(): void {
    this.el.classList.remove("show");
  }

  // The run started: hide soon, once it's been up for a few seconds.
  hideSoon(): void {
    const wait = Math.max(0, this.shownAt + MIN_SHOWN_MS - performance.now());
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), wait);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
  }
}
