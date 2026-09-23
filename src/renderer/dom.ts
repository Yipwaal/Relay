// Kleine DOM-helpers. Altijd textContent, nooit innerHTML: modeltekst en
// tool-resultaten komen van buiten en mogen nooit als HTML geïnterpreteerd worden.

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; title?: string; type?: string; text?: string } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.title) element.title = props.title;
  if (props.type && element instanceof HTMLButtonElement) element.type = props.type as 'button' | 'submit';
  if (props.text !== undefined) element.textContent = props.text;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

const ICON_PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close: 'M6 6l12 12M18 6L6 18',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  paperclip: 'M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5',
  chevron: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  doc: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5',
  docUpload: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M12 11v6M9 14l3-3 3 3',
};

function icon(name: keyof typeof ICON_PATHS, size = 16, strokeWidth = 2): SVGElement {
  const svg = svgEl('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.appendChild(svgEl('path', { d: ICON_PATHS[name] ?? '' }));
  return svg;
}

/**
 * Het schakelaar-symbool uit het logo, als tool-glyph: de "actieve" arm licht
 * op (klaar), is gedimd (bezig) of rood (mislukt). Kleur via CSS-klassen op
 * de omringende kaart, zodat CSP geen inline styles hoeft toe te staan.
 */
function relayGlyph(size: number, withInactiveArm: boolean): SVGElement {
  const svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' });
  const stroke = withInactiveArm ? 2 : 2.4;
  if (withInactiveArm) {
    svg.appendChild(svgEl('line', { x1: 12.6, y1: 7.4, x2: 16.8, y2: 16.5, stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', class: 'glyph-off' }));
    svg.appendChild(svgEl('circle', { cx: 16.8, cy: 16.5, r: 2.1, fill: 'currentColor', class: 'glyph-off' }));
  }
  svg.appendChild(svgEl('line', { x1: 12.6, y1: 7.4, x2: 7.6, y2: 16.5, stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', class: 'glyph-arm' }));
  svg.appendChild(svgEl('circle', { cx: 7.6, cy: 16.5, r: withInactiveArm ? 2.3 : 2.6, fill: 'currentColor', class: 'glyph-arm' }));
  svg.appendChild(svgEl('circle', { cx: 12.6, cy: 7.4, r: withInactiveArm ? 2.5 : 2.8, fill: 'currentColor', class: 'glyph-arm' }));
  return svg;
}

function iconButton(name: keyof typeof ICON_PATHS, title: string, tone: 'plain' | 'solid' | 'danger', onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const button = h('button', { class: `icon-btn icon-btn-${tone}`, title, type: 'button' }, [icon(name, 13, 2.2)]);
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

function describeUnknownError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Onbekende fout';
  // Electron verpakt fouten uit ipcMain.handle als "Error invoking remote method '...': Error: <bericht>".
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
