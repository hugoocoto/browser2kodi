// Builds the extension for each browser: extension/ copied to dist/chrome and
// dist/firefox, each with a manifest holding only the keys its browser knows.
// extension/ itself loads in either, with warnings about the other's keys.
//
//   node build.js

import fs from "node:fs";

const SOURCE = new URL("extension/", import.meta.url);

/** What each browser's manifest drops. */
const DROP = {
  chrome(m) {
    delete m.browser_specific_settings;
    delete m.background.scripts;
    delete m.action.default_area;
  },
  firefox(m) {
    delete m.key;
    delete m.background.service_worker;
  },
};

export const BROWSERS = Object.keys(DROP);

/** The manifest for a browser. */
export function manifest(browser) {
  const m = JSON.parse(fs.readFileSync(new URL("manifest.json", SOURCE)));
  DROP[browser](m);
  return m;
}

/** extension/ for a browser, in dir. */
export function build(browser, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(SOURCE, dir, { recursive: true });
  fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest(browser), null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const browser of BROWSERS) {
    build(browser, new URL(`dist/${browser}`, import.meta.url).pathname);
    console.log(`dist/${browser}`);
  }
}
