import { defineConfig } from 'vite';

// The site is served from https://alozich.github.io/anns-shelf/, so built
// asset URLs need that prefix (and `npm run preview` mirrors it).
// Local dev (`npm run dev`) still uses /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/anns-shelf/' : '/',
}));
