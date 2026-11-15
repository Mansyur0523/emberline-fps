// The look plan, in one place. Foundry dusk: warm ember orange against cold
// slate-teal, on dark brown-black. The same names are the CSS custom properties
// in index.html, so the page and the scene never drift apart.
export const PALETTE = {
  canvas: '#17130f',
  surface: '#241c15',
  hairline: '#3a2f24',
  ink: '#f2e9dc',
  muted: '#a89a86',
  accent: '#ff7a1a',
  teal: '#37b6c9',
  danger: '#ff3b30',
  site: '#ffd23e',
  concrete: '#6b6259',
  rust: '#8a4b2d',
  steel: '#4a5560',
  ember: '#ff5a00',
  foliage: '#5c6b3c',
};

export function shade(name) {
  return PALETTE[name];
}
