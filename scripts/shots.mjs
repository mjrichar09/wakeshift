// Screenshot every camera and check behaviour in a real browser:
//   node scripts/shots.mjs [url] [outdir]
// Set CHROMIUM_PATH to a Chrome/Edge/Chromium binary (defaults to Edge on Windows).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5199/";
const out = process.argv[3] ?? "shots";
mkdirSync(out, { recursive: true });
const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "/usr/bin/chromium");
const browser = await chromium.launch({ executablePath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const errors = [];
const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);

async function open(width, height, scheme = "dark", hash = "") {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await p.goto(url + hash, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  return p;
}

const p = await open(1440, 900);
// Every baseball camera at a mid-flight playhead.
const at = async (t) => p.evaluate((t) => { window.lab.playback.playing = false; window.lab.playback.scrub(t); }, t);
const views = await p.evaluate(() => [...document.querySelectorAll("#views button")].map((b) => b.dataset.view));
for (const v of views) {
  await p.evaluate((v) => window.lab.setView(v), v);
  await at(0.3);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/baseball-${v}.png` });
}
// Frame stepping is exactly 1 ms.
await p.evaluate(() => window.lab.setView("catcher"));
await at(0.2);
await p.keyboard.press("ArrowRight");
const t1 = await p.evaluate(() => window.lab.playback.t);
check("frame step = 1 ms", Math.abs(t1 - 0.201) < 1e-9, `t=${t1}`);
// 0.05× playback advances ~0.05 s of sim per second of wall time.
await p.evaluate(() => { const pb = window.lab.playback; pb.speed = 0.05; pb.scrub(0); pb.playing = true; });
await p.waitForTimeout(2000);
const t2 = await p.evaluate(() => window.lab.playback.t);
check("0.05× playback", t2 > 0.03 && t2 < 0.13, `sim ${t2.toFixed(3)} s after 2 s wall`);

// Flow lab with pressure and smoke at the moment of peak side force.
await p.evaluate(() => {
  const r = window.lab.rec;
  let best = 0, bi = 0;
  for (let i = 0; i < r.n; i++) { const m = Math.hypot(r.fSeam[3*i], r.fSeam[3*i+1], r.fSeam[3*i+2]); if (m > best) { best = m; bi = i; } }
  window.lab.setView("flowlab");
  window.lab.playback.playing = false;
  window.lab.playback.scrub(r.t[bi]);
});
await p.waitForTimeout(1800);
await p.screenshot({ path: `${out}/flowlab-peak.png` });

// Spray mode timing (50 runs).
const sprayMs = await p.evaluate(async () => { const t0 = performance.now(); await window.lab.doSpray(); return performance.now() - t0; });
check("spray 50 runs < ~1 s", sprayMs < 1500, `${sprayMs.toFixed(0)} ms`);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/spray.png` });

// Chart click scrubs playback.
await p.evaluate(() => window.lab.setView("catcher"));
const box = await p.locator(".chart .u-over").first().boundingBox();
await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
const t3 = await p.evaluate(() => window.lab.playback.t);
const dur = await p.evaluate(() => window.lab.playback.duration);
check("chart click scrubs", Math.abs(t3 / dur - 0.75) < 0.08, `t=${t3.toFixed(3)} of ${dur.toFixed(3)}`);

// Pin two runs (P), then all overlays + split screen: frame cost and a screenshot.
await p.keyboard.press("p");
await p.evaluate(() => window.lab.loadPreset("baseball", "half"));
await p.waitForTimeout(300);
await p.keyboard.press("p");
const pinCount = await p.evaluate(() => document.querySelectorAll("#pins [data-unpin]").length);
check("pin runs (P)", pinCount === 2, `${pinCount} pinned`);
await p.evaluate(() => {
  const o = window.lab.overlays;
  Object.keys(o.arrows).forEach((k) => (o.arrows[k] = true));
  Object.assign(o, { ring: true, tripBand: true, pressure: true, streamlines: true, wake: true, smoke: true });
  window.lab.display.split = true;
  window.dispatchEvent(new Event("resize"));
  window.lab.setView("catcher");
  window.lab.playback.speed = 0.1;
  window.lab.playback.replay();
});
await p.waitForTimeout(3000);
const ms = await p.evaluate(() => window.lab.frameMs);
console.log(`INFO  frame JS cost with every overlay + split: ${ms.toFixed(1)} ms (software GL in this harness)`);
await p.screenshot({ path: `${out}/split-all-overlays.png` });
await p.evaluate(() => { window.lab.display.split = false; window.dispatchEvent(new Event("resize")); });

// Share link: reload with the hash and get the same params back.
const before = await p.evaluate(() => JSON.stringify(window.lab.params));
const hash = await p.evaluate(() => location.hash);
const p2 = await open(1200, 800, "dark", hash);
const after = await p2.evaluate(() => JSON.stringify(window.lab.params));
check("URL hash restores params", before === after);
await p2.context().close();

// Guided tour: every step, no errors.
await p.click("#tour-open");
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(1400);
  await p.screenshot({ path: `${out}/tour-${i + 1}.png` });
  await p.click("#tour-next");
}
check("tour closes after the last step", await p.evaluate(() => document.getElementById("tour").hidden));

// Volleyball: fast vs slow float.
for (const id of ["fast", "slow"]) {
  await p.evaluate((id) => window.lab.loadPreset("volleyball", id), id);
  await p.waitForTimeout(800);
}
const views2 = await p.evaluate(() => [...document.querySelectorAll("#views button")].map((b) => b.dataset.view));
for (const v of views2) {
  await p.evaluate((v) => window.lab.setView(v), v);
  await at(0.6);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/volleyball-${v}.png` });
}
await p.context().close();

// Split screen, light theme, tablet.
const s = await open(1180, 820, "light");
await s.evaluate(() => { document.querySelector("#views button[data-view=catcher]").click(); });
await s.evaluate(() => { const lab = window.lab; lab.playback.playing = false; lab.playback.scrub(0.35); });
await s.waitForTimeout(400);
await s.screenshot({ path: `${out}/light-tablet.png` });
await s.context().close();

// Phone.
const m = await open(390, 844, "dark");
await m.screenshot({ path: `${out}/phone.png` });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone: no horizontal overflow", overflow <= 0, `${overflow}px`);
await m.context().close();

console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
