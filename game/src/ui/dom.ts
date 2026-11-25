// Small DOM helpers for the interface. The "live" setters remember the last
// value they wrote, so calling one ten times a second with an unchanged value
// costs a comparison and touches nothing in the page.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Marks an element with the stable hook the automated tests look for. */
export function hook<T extends Element>(node: T, id: string): T {
  node.setAttribute('data-testid', id);
  return node;
}

/** A real button. The gf-b class strips the browser's own button styling so each kind can set its look. */
export function button(className: string, testId = ''): HTMLButtonElement {
  const node = el('button', `gf-b ${className}`);
  node.type = 'button';
  if (testId) hook(node, testId);
  return node;
}

export type Shape = readonly [tag: 'path' | 'circle' | 'rect' | 'ellipse', attributes: Readonly<Record<string, string | number>>];

/** Builds an inline SVG picture from a list of shapes. Decorative: hidden from screen readers. */
export function svg(shapes: readonly Shape[], className: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('class', className);
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  for (const [tag, attributes] of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    root.appendChild(node);
  }
  return root;
}

/** Adds a text node to `parent` and returns a setter for it. */
export function liveText(parent: Node, initial = ''): (value: string) => void {
  const node = document.createTextNode(initial);
  parent.appendChild(node);
  let last = initial;
  return (value) => {
    if (value === last) return;
    last = value;
    node.data = value;
  };
}

export function liveClass(node: Element, className: string): (on: boolean) => void {
  let last = node.classList.contains(className);
  return (on) => {
    if (on === last) return;
    last = on;
    node.classList.toggle(className, on);
  };
}

export function liveAttr(node: Element, name: string): (value: string) => void {
  let last: string | null = node.getAttribute(name);
  return (value) => {
    if (value === last) return;
    last = value;
    node.setAttribute(name, value);
  };
}

/** Shows or hides an element through its `hidden` attribute. */
export function liveShown(node: HTMLElement, shown = true): (shown: boolean) => void {
  let last = shown;
  node.hidden = !shown;
  return (next) => {
    if (next === last) return;
    last = next;
    node.hidden = !next;
  };
}

export function liveDisabled(node: HTMLButtonElement): (disabled: boolean) => void {
  let last = node.disabled;
  return (disabled) => {
    if (disabled === last) return;
    last = disabled;
    node.disabled = disabled;
  };
}

/**
 * Drives a progress bar's fill from 0 to 1. The fill is scaled, not resized,
 * so the browser can move it without laying the page out again.
 */
export function liveFill(node: HTMLElement, axis: 'X' | 'Y' = 'X'): (fraction: number) => void {
  let last = -1;
  return (fraction) => {
    const steps = fraction >= 1 ? 1000 : fraction > 0 ? Math.round(fraction * 1000) : 0;
    if (steps === last) return;
    last = steps;
    node.style.transform = `scale${axis}(${steps / 1000})`;
  };
}

/** A bar with a fill inside it, plus the setter that drives the fill. */
export function progressBar(className: string): { bar: HTMLElement; set: (fraction: number) => void } {
  const bar = el('span', `gf-bar ${className}`);
  const fill = el('span', 'gf-bar-fill');
  bar.appendChild(fill);
  return { bar, set: liveFill(fill) };
}

/** Gives a canvas a bitmap sharp enough for its size on screen (CSS pixels), up to double density. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
}

/** True for anything the player can type into. */
export function isTextField(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node.isContentEditable;
}

/** True for controls that Space and Enter already operate by themselves. */
export function isControl(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement || isTextField(node);
}
