export const icons: Record<string, string> = {
  wood: '<path d="M12 2 5 12h4l-5 6h6v4h4v-4h6l-5-6h4Z"/>',
  food: '<path d="M12 22V4m0 10C5 14 4 9 4 7c5 0 8 3 8 7Zm0-4c7 0 8-5 8-7-5 0-8 3-8 7Zm0 10c7 0 8-5 8-7-5 0-8 3-8 7Z"/>',
  stone: '<path d="m3 17 3-9 9-4 6 9-4 7H7Zm3-9 7 5 2-9m-2 9 4 7m-4-7L3 17"/>',
  insight: '<path d="M9 18h6m-5 3h4M8 14c-5-5-2-11 4-11s9 6 4 11l-1 2H9Z"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
  heart:
    '<path d="M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13Z"/>',
  house: '<path d="m2 11 10-8 10 8M5 10v11h14V10M9 21v-7h6v7M2 12h20"/>',
  hall: '<path d="m2 13 10-5 10 5H2Zm3 0v8h14v-8M9 21v-5h6v5M6 7l6-4 6 4H6Zm3 0v3m6-3v3"/>',
  store: '<path d="m3 8 9-5 9 5v13H3V8Zm0 0h18M7 21V11h10v10M7 16h10"/>',
  farm: '<path d="m2 14 10-5 10 5-10 7-10-7Zm5 2 10-5M7 11l10 7M12 9V2m0 4L8 3m4 4 4-4"/>',
  workshop: '<path d="m3 21 10-10m-3-5 4-4 8 8-4 4-8-8ZM3 14v7h7M4 4l4 4"/>',
  tea: '<path d="M3 9h14v6a7 7 0 0 1-14 0V9Zm14 1h2a3 3 0 0 1 0 6h-2M5 3v3m5-4v4m5-3v3M2 22h18"/>',
  shrine:
    '<path d="M3 4q9 3 18 0M2 8h20M6 5v17M18 5v17M6 13h12M11 8v4m2-4v4"/>',
  road: '<path d="m7 2-4 20m14-20 4 20M12 3v3m0 4v4m0 4v3"/>',
  bridge:
    '<path d="M2 15h20M3 10v11m18-11v11M7 7v14M17 7v14M3 11q9-8 18 0M2 22q3-3 6 0 3-3 6 0 3-3 8 0"/>',
  leaf: '<path d="M20 3C8 1 1 8 5 16s17 3 15-13ZM3 22 16 8"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  play: '<path d="m7 3 14 9-14 9Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  gear: '<path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 2 4 4-1 1-3 4-1v-4l-3-2V6l-4-1-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8c0-4 7-4 6 1 0 2-3 2-3 5m0 3v1"/>',
  research:
    '<path d="M3 4h7l2 3 2-3h7v16h-7l-2 2-2-2H3V4Zm9 3v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  flag: '<path d="M5 22V3m0 1c5-5 9 5 15 0v9c-6 5-10-5-15 0"/>',
};
export function icon(name: string, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.leaf}</svg>`;
}
