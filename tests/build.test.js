// Tests of build.js: each browser's manifest has the keys it knows, and only those.

import assert from "node:assert/strict";
import { test } from "node:test";
import { manifest } from "../build.js";

test("Chrome: a service worker, and the key that fixes its ID", () => {
  const m = manifest("chrome");
  assert.equal(m.background.service_worker, "background.js");
  assert.ok(m.key);
  assert.equal(m.background.scripts, undefined);
  assert.equal(m.browser_specific_settings, undefined);
  assert.equal(m.action.default_area, undefined);
});

test("Firefox: a background script, and its ID", () => {
  const m = manifest("firefox");
  assert.deepEqual(m.background.scripts, ["background.js"]);
  assert.match(m.browser_specific_settings.gecko.id, /^browser2kodi@/);
  assert.equal(m.background.service_worker, undefined);
  assert.equal(m.key, undefined);
});

test("Kodi is reached over plain HTTP", () => {
  // Firefox's default policy turns requests to http: into https:, which Kodi doesn't speak.
  for (const browser of ["chrome", "firefox"]) {
    assert.doesNotMatch(manifest(browser).content_security_policy.extension_pages,
                        /upgrade-insecure-requests/);
  }
});
