// The Firefox add-on, as Mozilla signed it, from addons.mozilla.org (AMO).
// The release workflow submits each version there with web-ext; it can be
// downloaded once Mozilla approves it, which can take minutes or days.
//
//   AMO_JWT_ISSUER=... AMO_JWT_SECRET=... node amo.js 0.3.1 out.xpi [minutes]
//
// Waits up to minutes (default 0) for the approval. Exits with 0 once out.xpi
// is there, 3 if the version still awaits review, 1 on anything else.

import crypto from "node:crypto";
import fs from "node:fs";
import { manifest } from "./build.js";

const API = "https://addons.mozilla.org/api/v5/";
const ID = manifest("firefox").browser_specific_settings.gecko.id;
const AWAITING_REVIEW = 3;

const base64 = (data) => Buffer.from(data).toString("base64url");

/** The Authorization header AMO wants: a JWT signed with the API key. */
function auth() {
  const now = Math.floor(Date.now() / 1000);
  const head = base64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64(JSON.stringify({
    iss: process.env.AMO_JWT_ISSUER, jti: crypto.randomUUID(), iat: now, exp: now + 60 }));
  const signature = crypto.createHmac("sha256", process.env.AMO_JWT_SECRET ?? "")
    .update(`${head}.${claims}`).digest("base64url");
  return `JWT ${head}.${claims}.${signature}`;
}

async function get(url) {
  const r = await fetch(new URL(url, API), { headers: { Authorization: auth() } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}

const [version, out, minutes = "0"] = process.argv.slice(2);
if (!version || !out) {
  console.error("usage: node amo.js VERSION OUT.xpi [MINUTES]");
  process.exit(1);
}
const deadline = Date.now() + Number(minutes) * 60000;
for (;;) {
  // "v": by version number, which could otherwise pass for an id.
  const { file } = await (await get(`addons/addon/${ID}/versions/v${version}/`)).json();
  if (file.status === "public") {
    fs.writeFileSync(out, Buffer.from(await (await get(file.url)).arrayBuffer()));
    console.log(`${out}: browser2kodi ${version}, signed by Mozilla`);
    break;
  }
  if (file.status !== "unreviewed") {
    console.error(`Mozilla didn't approve browser2kodi ${version}: it is ${file.status}.`);
    process.exit(1);
  }
  if (Date.now() >= deadline) {
    console.log(`browser2kodi ${version} still awaits review on addons.mozilla.org.`);
    process.exit(AWAITING_REVIEW);
  }
  await new Promise((resolve) => setTimeout(resolve, 30000));
}
