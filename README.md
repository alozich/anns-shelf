# Ann's Shelf

A pixel-art 3D record shelf built with Three.js. Hover a sleeve to pull the
record out and hear a preview; hover the knick-knacks around it for little
animations and sounds.

**Live:** https://alozich.github.io/anns-shelf/

## Run it locally

```sh
npm install
npm run dev
```

## Where things live

- `src/albums.js`: the record collection (titles, covers, preview tracks)
- `src/knickknacks.js`: everything on the side shelves
- `src/audio.js`: song previews and the synthesized sound effects
- `src/pixel.js`: pixel-art settings (texture size, whole-scene pixel size)
- `public/covers/`: album cover images

Pushing to `main` rebuilds and publishes the site automatically
(`.github/workflows/deploy.yml`).

Album artwork and song previews belong to their respective artists and labels.
