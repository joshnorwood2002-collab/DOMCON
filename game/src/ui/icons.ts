// Every picture in the interface is drawn here as inline SVG: no image files
// and no icon font. Shapes sit on a 24 x 24 grid and are stroked in the
// current text colour unless marked SOLID.

import { svg, type Shape } from './dom.ts';

type Attributes = Readonly<Record<string, string | number>>;

const SOLID: Attributes = { fill: 'currentColor', stroke: 'none' };

const path = (d: string, extra: Attributes = {}): Shape => ['path', { d, ...extra }];
const circle = (cx: number, cy: number, r: number, extra: Attributes = {}): Shape => ['circle', { cx, cy, r, ...extra }];
const ellipse = (cx: number, cy: number, rx: number, ry: number, extra: Attributes = {}): Shape => ['ellipse', { cx, cy, rx, ry, ...extra }];
const rect = (x: number, y: number, width: number, height: number, rx: number, extra: Attributes = {}): Shape => [
  'rect',
  { x, y, width, height, rx, ...extra },
];

/** A cog outline with blunt teeth around the centre of the grid. */
function cog(teeth: number, outer: number, inner: number): string {
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let tooth = 0; tooth < teeth; tooth++) {
    const angle = tooth * step - Math.PI / 2;
    const corners: readonly (readonly [number, number])[] = [
      [inner, angle - step * 0.3],
      [outer, angle - step * 0.16],
      [outer, angle + step * 0.16],
      [inner, angle + step * 0.3],
    ];
    for (const [radius, at] of corners) {
      d += `${d ? 'L' : 'M'}${(12 + radius * Math.cos(at)).toFixed(2)} ${(12 + radius * Math.sin(at)).toFixed(2)}`;
    }
  }
  return `${d}Z`;
}

const DRONE: readonly Shape[] = [
  rect(5.5, 10, 13, 6.5, 3.25),
  circle(9.3, 13.25, 1.4, SOLID),
  path('M8 10V7.2M16 10V7.2M5 7.2h6M13 7.2h6M18.5 13.25H21'),
];

const TROPHY: readonly Shape[] = [
  path('M7.5 4h9v5a4.5 4.5 0 0 1-9 0z'),
  path('M7.5 6H4.6v1.2a3 3 0 0 0 3 3M16.5 6h2.9v1.2a3 3 0 0 1-3 3M12 13.5v4M8.5 20h7M10 17.5h4'),
];

const ICONS = {
  /** The four-point star that stands for lumens. */
  star: [path('M12 1.5c.7 6 4.5 9.8 10.5 10.5-6 .7-9.8 4.5-10.5 10.5C11.3 16.5 7.5 12.7 1.5 12 7.5 11.3 11.3 7.5 12 1.5z', SOLID)],
  gear: [path(cog(8, 9.8, 7.3)), circle(12, 12, 3)],
  gift: [
    rect(4, 11, 16, 9.5, 1.6),
    rect(3, 7.5, 18, 3.5, 1.2),
    path('M12 7.5v13'),
    path('M12 7.5C10.5 4 7 3.6 7 5.6c0 1.6 2.6 1.9 5 1.9zM12 7.5c1.5-3.5 5-3.9 5-1.9 0 1.6-2.6 1.9-5 1.9z'),
  ],
  /** The cut gem that stands for Renown. */
  renown: [path('M12 2.8l7.6 6.9L12 21.2 4.4 9.7z', { fill: 'currentColor', 'fill-opacity': 0.22 }), path('M4.4 9.7h15.2M9 9.7l3-6.9 3 6.9-3 11.5z')],
  sonar: [circle(12, 12, 1.8, SOLID), path('M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13')],
  fish: [path('M3 12c2.6-4.4 8.6-5 12.5 0-3.9 5-9.9 4.4-12.5 0z'), path('M15.5 12l5-3.8v7.6z'), circle(7.4, 11.3, 0.9, SOLID)],
  dive: [path('M6.5 5.5l5.5 5.5 5.5-5.5M6.5 12.5l5.5 5.5 5.5-5.5')],
  lock: [rect(5, 10.5, 14, 10, 2.2), path('M8 10.5V8a4 4 0 0 1 8 0v2.5')],
  check: [path('M5 12.6l4.4 4.4L19 7.4')],
  trophy: TROPHY,
  sub: [rect(2.5, 9.5, 16, 8, 4), rect(8.5, 6.2, 5.5, 3.3, 1.2), circle(7.5, 13.5, 1.2, SOLID), circle(12, 13.5, 1.2, SOLID), path('M18.5 13.5h2.6M21.1 11v5')],
  close: [path('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  hull: [path('M12 3.2l7 2.6v5.4c0 4.4-2.8 7.7-7 9.6-4.2-1.9-7-5.2-7-9.6V5.8z')],
  back: [path('M19 12H6M11 6.5L5.5 12l5.5 5.5')],
  clock: [circle(12, 12, 8.5), path('M12 7.3V12l3.2 2')],
  tap: [circle(12, 12, 2.6, SOLID), circle(12, 12, 7.6)],
  scan: [circle(12, 12, 6.5), path('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4'), circle(12, 12, 1.4, SOLID)],
  analysis: [path('M5 19.5V11M10 19.5V5M15 19.5v-6M20 19.5V8.5')],
  fleet: DRONE,
  research: [path('M9.5 3.5h5M10.5 3.5v5.6L5.6 17.8a1.8 1.8 0 0 0 1.6 2.7h9.6a1.8 1.8 0 0 0 1.6-2.7l-4.9-8.7V3.5M7.8 15.5h8.4')],
  codex: [path('M12 6.2C9.8 4.8 7 4.4 4 4.8v13c3-.4 5.8 0 8 1.4 2.2-1.4 5-1.8 8-1.4v-13c-3-.4-5.8 0-8 1.4zM12 6.2v13')],
  institute: [path('M3.5 9.5L12 4.5l8.5 5zM6 10v7.5M10 10v7.5M14 10v7.5M18 10v7.5M4 20h16')],
  goals: TROPHY,
} satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = ''): SVGSVGElement {
  return svg(ICONS[name], className ? `gf-icon ${className}` : 'gf-icon');
}

/** One small picture per fleet tier, indexed like GENERATORS. */
const FLEET_GLYPHS: readonly (readonly Shape[])[] = [
  // Glow Buoy: a lamp on a float.
  [
    circle(12, 8, 3.1),
    path('M12 2.2v1.5M6.6 4.4l1.1 1.1M17.4 4.4l-1.1 1.1'),
    path('M9 11.4h6l1.4 6.4H7.6z'),
    path('M3 20.6c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0'),
  ],
  // Scout Drone: a small camera craft with two rotors.
  DRONE,
  // Lantern Rig: a hanging lamp with a flame.
  [
    path('M9 6.2a3 3 0 0 1 6 0M7.6 6.2h8.8'),
    rect(8.4, 6.2, 7.2, 10.6, 1.2),
    path('M12 9.6c1.5 1.5 1.5 3.2 0 4.4-1.5-1.2-1.5-2.9 0-4.4z', SOLID),
    path('M7.6 16.8h8.8M9.4 16.8v3M14.6 16.8v3M8 19.8h8'),
  ],
  // Sonar Array: a mast sending rings outward.
  [
    circle(12, 10.5, 1.7, SOLID),
    path('M12 12.2v7.6M8.4 20h7.2'),
    path('M8.5 7a5 5 0 0 0 0 7M15.5 7a5 5 0 0 1 0 7M5.8 4.4a8.6 8.6 0 0 0 0 12.2M18.2 4.4a8.6 8.6 0 0 1 0 12.2'),
  ],
  // Specimen Lab: a jar with a small fish in it.
  [rect(8, 3.2, 8, 2.8, 1), rect(5.8, 6, 12.4, 14.8, 3.2), path('M8.6 13.4c1.5-2 4-2 5.5 0-1.5 2-4 2-5.5 0z'), path('M14.1 13.4l2-1.5v3z')],
  // Deep Rover: a tracked crawler with a lamp mast.
  [
    rect(3, 14.2, 18, 5.6, 2.8),
    circle(6.8, 17, 0.9, SOLID),
    circle(12, 17, 0.9, SOLID),
    circle(17.2, 17, 0.9, SOLID),
    path('M6 14.2v-3a2 2 0 0 1 2-2h5.4l3.8 5M9.5 9.2V5.8'),
    circle(9.5, 4.7, 1.1),
  ],
  // Thermal Probe: a thermometer with heat rising either side.
  [
    path('M12 3.2a2.2 2.2 0 0 0-2.2 2.2v7.9a4.2 4.2 0 1 0 4.4 0V5.4A2.2 2.2 0 0 0 12 3.2z'),
    path('M12 8.5v6.5'),
    circle(12, 16.8, 1.5, SOLID),
    path('M18.4 5.5c1 1 1 2.1 0 3.1s-1 2.1 0 3.1M5.6 5.5c-1 1-1 2.1 0 3.1s1 2.1 0 3.1'),
  ],
  // Abyss Station: a dome on legs with an aerial.
  [
    path('M4.6 16.8a7.4 7.4 0 0 1 14.8 0z'),
    path('M2.8 16.8h18.4M6.5 16.8v3.4M12 16.8v3.4M17.5 16.8v3.4M12 9.4V5.8'),
    circle(9.4, 13.2, 1),
    circle(14.6, 13.2, 1),
    circle(12, 4.8, 1, SOLID),
  ],
  // Silt Harvester: a sifting funnel with grains falling out.
  [path('M4.5 5h15l-5.2 6.6v5l-4.6 2.6v-7.6z'), circle(6, 19.6, 0.8, SOLID), circle(17.6, 17.6, 0.8, SOLID), circle(19.4, 20.4, 0.8, SOLID)],
  // Trench Crawler: a six-legged walker.
  [
    ellipse(12, 11.5, 4.4, 3.4),
    circle(12, 11.5, 1.1, SOLID),
    path('M8.3 9.6L5 6.4M7.7 12l-4.2.8M8.8 14.2l-3 4.4M15.7 9.6L19 6.4M16.3 12l4.2.8M15.2 14.2l3 4.4'),
  ],
  // Pressure Forge: an anvil throwing a spark.
  [
    path('M3.5 8H17a3.5 3.5 0 0 1-3.5 3.5h-1v3.2h2.6v2.6H7.4v-2.6H10v-3.2H7A3.5 3.5 0 0 1 3.5 8z'),
    path('M5.5 20.4h13M20 3.4V6M18.7 4.7h2.6'),
  ],
  // Leviathan Listener: a whale's tail under rising sound.
  [
    path('M12 20.5v-6.2'),
    path('M12 14.3c-.8-3.6-3.6-5.3-7.4-5.3.2 3.7 3.1 6 7.4 5.3zM12 14.3c.8-3.6 3.6-5.3 7.4-5.3-.2 3.7-3.1 6-7.4 5.3z'),
    path('M9.2 5.8a4.2 4.2 0 0 1 5.6 0M7 3.4a7.4 7.4 0 0 1 10 0'),
  ],
];

/** Accent hue (0-360) for each fleet tier's tile, drifting from surface cyan to deep violet. */
const TIER_HUES: readonly number[] = [174, 190, 42, 204, 152, 28, 8, 216, 48, 262, 18, 286];

/** A fleet unit's picture inside its tinted tile. */
export function fleetTile(tier: number): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'gf-glyph';
  tile.style.setProperty('--hue', String(TIER_HUES[tier] ?? 190));
  tile.appendChild(svg(FLEET_GLYPHS[tier] ?? DRONE, 'gf-icon'));
  return tile;
}

/** A plain icon inside the same kind of tile, for rows that are not fleet units. */
export function iconTile(name: IconName, hue: number): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'gf-glyph';
  tile.style.setProperty('--hue', String(hue));
  tile.appendChild(icon(name));
  return tile;
}

/** The game's mark: a small glowing jellyfish, matching the favicon. */
export function logo(): SVGSVGElement {
  return svg(
    [
      path('M12 34c0-13 9-22 20-22s20 9 20 22c-3 3-6 3-9 0-4 4-7 4-11 0-4 4-7 4-11 0-3 3-6 3-9 0z', SOLID),
      path('M22 38c-2 6 2 9 0 15M32 40c2 6-2 9 0 15M42 38c2 6-2 9 0 15', { 'stroke-width': 2.6, opacity: 0.8 }),
    ],
    'gf-logo',
    '0 0 64 64',
  );
}
