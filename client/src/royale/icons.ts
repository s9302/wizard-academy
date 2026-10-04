// Small line icons for the action bar, drawn as SVG so they look the same
// on every computer (emoji fonts vary, and some systems have none).
// Static strings only: safe to put in innerHTML.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  // Spells
  bolt: svg('<path d="M12 2.5l2 7.5 7.5 2-7.5 2-2 7.5-2-7.5L2.5 12l7.5-2z" fill="currentColor" fill-opacity="0.25"/>'),
  frost: svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5M3.5 10.5l3.4-.9-.9-3.4M20.5 13.5l-3.4.9.9 3.4M3.5 13.5l3.4.9-.9 3.4M20.5 10.5l-3.4-.9.9-3.4"/>'),
  spark: svg('<path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12z" fill="currentColor" fill-opacity="0.25"/>'),
  fireball: svg('<path d="M12 22c4 0 7-2.8 7-6.8 0-3.5-2.2-5.4-3.6-7.6-.4 1.6-1.2 2.6-2.2 3.1C13.6 7.3 12 4.3 9 2c.4 3.3-1.3 5.4-2.8 7.4C5 11 5 12.6 5 15.2 5 19.2 8 22 12 22z" fill="currentColor" fill-opacity="0.25"/><path d="M12 22c-1.7 0-3-1.3-3-3.1 0-1.8 1.4-2.6 2-4.4 1.4 1 3.9 2.7 3.9 4.6 0 1.6-1.2 2.9-2.9 2.9z"/>'),
  // Weapons
  sword: svg('<path d="M20 4l-1 4.5L9.5 18 6 14.5 15.5 5z"/><path d="M5 13l6 6M7.5 16.5L4 20M3 19l2 2"/>'),
  shield: svg('<path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10.5C7.4 20.3 4 16.5 4 11.5v-6z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v12"/>'),
  bow: svg('<path d="M6 3c8 2 13 7 15 15"/><path d="M6 3l15 15"/><path d="M3 21l12-12M15 9h-3.5M15 9v3.5M3 21l2.5-.5M3 21l.5-2.5"/>'),
  daggers: svg('<path d="M4 4l9 9M13 13l2 2M15 11l-4 4M17 17l3 3"/><path d="M20 4l-9 9M11 13l-2 2M9 11l4 4M7 17l-3 3"/>'),
  staff: svg('<path d="M8 21L16.5 8"/><circle cx="18" cy="5.5" r="3" fill="currentColor" fill-opacity="0.3"/><path d="M14 4l-1.5-1.5M21.5 9.5L20 8"/>'),
  // Abilities
  wall: svg('<rect x="3" y="6" width="18" height="13" rx="1"/><path d="M3 10.3h18M3 14.6h18M9 6v4.3M15 6v4.3M6 10.3v4.3M12 10.3v4.3M18 10.3v4.3M9 14.6V19M15 14.6V19"/>'),
  pillar: svg('<path d="M6 21h12M7 18h10M8 18V7M16 18V7M12 18V7M6 7h12M7.5 4.5h9L18 7H6z"/>'),
  blink: svg('<path d="M4 12h9M6 8h6M6 16h6"/><circle cx="17.5" cy="12" r="3.5" fill="currentColor" fill-opacity="0.3"/>'),
  stealth: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>'),
  charge: svg('<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>'),
  // Cleric
  mace: svg('<path d="M6 20l7-7"/><circle cx="15.5" cy="8.5" r="4" fill="currentColor" fill-opacity="0.25"/><path d="M15.5 2.5v2M21.5 8.5h-2M15.5 14.5v-2M11.5 8.5h-2"/>'),
  holy: svg('<circle cx="12" cy="10" r="3.5" fill="currentColor" fill-opacity="0.3"/><path d="M12 2.5v2M12 15.5v2M4.5 10h2M17.5 10h2M6.7 4.7l1.4 1.4M15.9 13.9l1.4 1.4M6.7 15.3l1.4-1.4M15.9 6.1l1.4-1.4M12 17.5V22"/>'),
  heal: svg('<path d="M12 20.5s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z" fill="currentColor" fill-opacity="0.2"/><path d="M12 10.5v6M9 13.5h6"/>'),
  smite: svg('<path d="M9 2h6l-1 9h-4z" fill="currentColor" fill-opacity="0.3"/><path d="M12 11v5"/><ellipse cx="12" cy="19" rx="7" ry="2.5"/><path d="M6 15l-2-1.5M18 15l2-1.5"/>'),
  sanctuary: svg('<path d="M3 20a9 9 0 0 1 18 0z" fill="currentColor" fill-opacity="0.2"/><path d="M12 7v6M9 10h6"/>'),
  aegis: svg('<path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10.5C7.4 20.3 4 16.5 4 11.5v-6z" fill="currentColor" fill-opacity="0.2"/><path d="M12 7l1.3 3 3.2.3-2.4 2.1.7 3.1-2.8-1.6-2.8 1.6.7-3.1-2.4-2.1 3.2-.3z"/>'),
  judgment: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  // Level 11+ abilities
  tornado: svg('<path d="M3 4h18M5 8h14M7.5 12h10M10 16h6M12 20h2"/>'),
  flames: svg('<path d="M3 20h18"/><path d="M6 20c-1.5-2-1-4 .5-5.5.3 1.2 1 1.8 1.6 2 0-2 .8-3.6 2.4-4.5-.3 2.4 1.5 3.5 1.5 5.5 0 1.2-.6 2-1.5 2.5M14 20c-1-1.6-.6-3.2.6-4.4.2 1 .8 1.4 1.3 1.6 0-1.6.6-2.9 1.9-3.6-.2 1.9 1.2 2.8 1.2 4.4 0 1-.5 1.6-1.2 2"/>'),
  hellpit: svg('<ellipse cx="12" cy="15" rx="9" ry="4" fill="currentColor" fill-opacity="0.35"/><path d="M8 13c.5-2 1.5-3 1-5M12 12c.6-2.5 2-3.5 1.2-6.5M16 13c.4-1.6 1.2-2.4.8-4"/>'),
  invert: svg('<path d="M12 3v18"/><path d="M8 7l4-4 4 4M8 17l4 4 4-4"/><path d="M4 12a8 8 0 0 0 16 0" stroke-dasharray="2 2.5"/>'),
  shockwave: svg('<circle cx="12" cy="12" r="2.5" fill="currentColor" fill-opacity="0.4"/><path d="M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>'),
  nullzone: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/><path d="M12 7.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="currentColor" fill-opacity="0.3"/>'),
  giant: svg('<circle cx="8" cy="7" r="2"/><path d="M8 9.5v5M5.5 12h5M6.5 20l1.5-5.5 1.5 5.5"/><circle cx="16.5" cy="5" r="2.5"/><path d="M16.5 8v7M13 11h7M14.5 21l2-6 2 6"/>'),
  chain: svg('<rect x="2.5" y="9.5" width="7" height="5" rx="2.5"/><rect x="8.5" y="9.5" width="7" height="5" rx="2.5"/><path d="M15.5 12h3M18.5 8.5l3 3.5-3 3.5"/>'),
  decoys: svg('<circle cx="12" cy="6" r="2.2"/><path d="M12 8.5v6M9 11h6M10 20l2-5.5 2 5.5"/><circle cx="5" cy="8" r="1.6" stroke-dasharray="1.5 1.5"/><path d="M5 10v4.5M4 19l1-4.5 1 4.5" stroke-dasharray="1.5 1.5"/><circle cx="19" cy="8" r="1.6" stroke-dasharray="1.5 1.5"/><path d="M19 10v4.5M18 19l1-4.5 1 4.5" stroke-dasharray="1.5 1.5"/>'),
  glide: svg('<path d="M2.5 12c3-4 6.5-5 9.5-5s6.5 1 9.5 5c-2-1-4-1.3-5.5-.6L12 16l-4-4.6c-1.5-.7-3.5-.4-5.5.6z" fill="currentColor" fill-opacity="0.2"/><path d="M12 16v4"/>'),
  smoke: svg('<circle cx="8" cy="13" r="4" fill="currentColor" fill-opacity="0.2"/><circle cx="15" cy="11" r="5" fill="currentColor" fill-opacity="0.2"/><circle cx="13" cy="17" r="3.5" fill="currentColor" fill-opacity="0.2"/>'),
  fortify: svg('<path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10.5C7.4 20.3 4 16.5 4 11.5v-6z" fill="currentColor" fill-opacity="0.2"/><path d="M12 8.5v7M8.5 12h7"/>'),
};
