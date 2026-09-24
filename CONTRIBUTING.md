# Contributing to MoilStack .md

Issues and pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

## Run from source

Requires [Node.js](https://nodejs.org/) v18 or later and npm.

```bash
git clone https://github.com/moilstack/moilstack-md.git
cd moilstack-md
npm install
npm start
```

`npm start` uses `nodemon` — the app reloads when you change any file in `src/`.

## Run tests

```bash
npm test
```

## Build installers

```bash
npm run package
```

Output goes to `dist/`. Targets: NSIS/ZIP (Windows), DMG/ZIP (macOS), AppImage/DEB (Linux).

## Branding

The project name, logo, and visual branding assets are not open source — see [BRANDING.md](BRANDING.md).
