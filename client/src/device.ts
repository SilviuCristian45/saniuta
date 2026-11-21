// What kind of device the page runs on, decided once at startup (layout constants depend on it).

const params = new URLSearchParams(window.location.search);

function detectTouch(): boolean {
  // ?touch / ?touch=0 force the phone layout on or off, for testing on a desktop.
  const forced = params.get('touch');
  if (forced !== null) return forced !== '0';
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** A phone or tablet: touch controls, the rotate prompt, reduced effects by default. */
export const isTouch = detectTouch();
