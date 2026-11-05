// Respects the visitor's "reduce motion" setting (in their OS or browser).
// When it's on, decorative movement is switched off: camera drift, tilting
// toward the cursor, the guitar swing, screen flicker, flying darts.
const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');

export const reducedMotion = () => Boolean(query?.matches);
