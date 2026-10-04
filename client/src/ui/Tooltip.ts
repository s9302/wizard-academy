// A hover panel for game things (abilities, weapons): a title, a few
// label/value rows and a sentence, next to the cursor. One panel, shared;
// attach() wires an element to it. Text only (textContent), never HTML.

import type { Info } from "../../../shared/src/abilityInfo.ts";

let panel: HTMLDivElement | null = null;

function el(): HTMLDivElement {
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "tooltip";
    panel.hidden = true;
    document.body.appendChild(panel);
  }
  return panel;
}

function show(info: Info, x: number, y: number): void {
  const p = el();
  p.replaceChildren();
  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = info.title;
  p.appendChild(title);
  for (const [label, value] of info.lines) {
    const row = document.createElement("div");
    row.className = "tip-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value;
    row.append(l, v);
    p.appendChild(row);
  }
  if (info.text) {
    const t = document.createElement("div");
    t.className = "tip-text";
    t.textContent = info.text;
    p.appendChild(t);
  }
  p.hidden = false;
  move(x, y);
}

function move(x: number, y: number): void {
  const p = el();
  const w = p.offsetWidth;
  const h = p.offsetHeight;
  // Beside the cursor, kept on screen.
  p.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
  p.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y - h / 2))}px`;
}

export function hideTooltip(): void {
  if (panel) panel.hidden = true;
}

// Show `info()` while the cursor is over `target`.
export function attachTooltip(target: HTMLElement, info: () => Info | null): void {
  target.addEventListener("mouseenter", (e) => {
    const i = info();
    if (i) show(i, e.clientX, e.clientY);
  });
  target.addEventListener("mousemove", (e) => {
    if (panel && !panel.hidden) move(e.clientX, e.clientY);
  });
  target.addEventListener("mouseleave", hideTooltip);
  target.addEventListener("click", hideTooltip);
}
