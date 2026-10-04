// The site icon: a purple wizard's hat with a gold band and stars. Served by
// the game server at /auth/favicon.svg, the one path that needs no session,
// so the PIN page shows it too.

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
<linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b6bff"/><stop offset="1" stop-color="#4a2a9e"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4fe0"/><stop offset="1" stop-color="#3b2180"/></linearGradient>
</defs>
<path d="M34 4c-3 5-9 14-13 24l-6 20h34l-4-15c-1-4 0-8 4-11l5-3c-5 0-9 1-12 4 0-7-3-13-8-19z" fill="url(#h)" stroke="#1d1240" stroke-width="2" stroke-linejoin="round"/>
<path d="M17 41h30l1 7H16z" fill="#e8c547" stroke="#1d1240" stroke-width="2" stroke-linejoin="round"/>
<ellipse cx="32" cy="52" rx="29" ry="8" fill="url(#b)" stroke="#1d1240" stroke-width="2"/>
<path d="M29 20l1.5 3.5 3.5 1.5-3.5 1.5L29 30l-1.5-3.5L24 25l3.5-1.5z" fill="#ffe58a"/>
<circle cx="37" cy="33" r="1.8" fill="#ffe58a"/>
<circle cx="35" cy="13" r="1.3" fill="#ffe58a"/>
</svg>
`;
