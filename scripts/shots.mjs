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
async function shot(page, path) {
  await page.evaluate(() => window.lab.setQuality("high"));
  await page.waitForTimeout(1200);
  await page.screenshot({ path });
  await page.evaluate(() => window.lab.setQuality("low"));
}
const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);

async function open(width, height, scheme = "dark", hash = "", firstVisit = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
  // Screenshots use High graphics; the first-visit run keeps Auto to check the fallback.
  // Software GL at High saturates every core here, so checks run at Low and each
  // screenshot switches to High for the picture. The first-visit run keeps Auto.
  if (!firstVisit) await ctx.addInitScript(() => { localStorage.setItem("kl-visited", "1"); localStorage.setItem("kl-quality", "low"); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await p.goto(url + hash, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  return p;
}

// First visit starts the tour.
{
  const f = await open(1440, 900, "dark", "", true);
  await f.waitForTimeout(1200);
  const toured = await f.waitForFunction(() => !document.getElementById("tour").hidden, null, { timeout: 5000 }).then(() => true, () => false);
  check("first visit opens the guided tour", toured);
  await f.waitForTimeout(5000);
  console.log("INFO  auto graphics after probing:", await f.evaluate(() => document.getElementById("caption-text").textContent.includes("Low") ? "switched to Low (slow software GL)" : "stayed High"));
  await f.screenshot({ path: `${out}/first-visit.png` });
  await f.context().close();
}

const p = await open(1440, 900);
const at = async (t) => p.evaluate((t) => { window.lab.playback.playing = false; window.lab.playback.scrub(t); }, t);
const views = await p.evaluate(() => [...document.querySelectorAll("#views button")].map((b) => b.dataset.view));
for (const v of views) {
  await p.evaluate((v) => window.lab.setView(v), v);
  await at(0.3);
  await p.waitForTimeout(1500);
  await shot(p, `${out}/baseball-${v}.png`);
}

// Ball cam: the orbit target stays on the ball as it flies, and an orbit offset survives.
await p.evaluate(() => { window.lab.setView("ball"); window.lab.playback.scrub(0.05); window.lab.playback.playing = false; });
await p.waitForTimeout(1600);
const follow = await p.evaluate(async () => {
  const lab = window.lab;
  const ballAt = () => { const r = lab.rec, pb = lab.playback; const i = Math.min(r.n - 1, Math.round(pb.t / r.dt)); return [r.r[3 * i], r.r[3 * i + 1], r.r[3 * i + 2]]; };
  // Simulate a user orbit: move the camera sideways around the target.
  lab.camera.position.x += 0.6;
  const off0 = lab.camera.position.clone().sub(lab.controls.target);
  lab.playback.speed = 0.5;
  lab.playback.playing = true;
  await new Promise((r) => setTimeout(r, 900));
  lab.playback.playing = false;
  await new Promise((r) => setTimeout(r, 200));
  const b = ballAt();
  const tgt = lab.controls.target;
  const off1 = lab.camera.position.clone().sub(tgt);
  return { targetErr: Math.hypot(tgt.x - b[0], tgt.y - b[1], tgt.z - b[2]), offsetDrift: off1.sub(off0).length(), moved: lab.playback.t };
});
check("ball cam keeps the orbit target on the ball", follow.targetErr < 0.05, `err ${follow.targetErr.toFixed(3)} m after t=${follow.moved.toFixed(3)} s`);
check("ball cam keeps the user's orbit offset", follow.offsetDrift < 0.15, `drift ${follow.offsetDrift.toFixed(3)} m`);
await shot(p, `${out}/ball-cam-orbit.png`);

// Frame stepping is exactly 1 ms.
await p.evaluate(() => window.lab.setView("catcher"));
await at(0.2);
await p.keyboard.press("ArrowRight");
const t1 = await p.evaluate(() => window.lab.playback.t);
check("frame step = 1 ms", Math.abs(t1 - 0.201) < 1e-9, `t=${t1}`);
await p.evaluate(() => { const pb = window.lab.playback; pb.speed = 0.05; pb.scrub(0); pb.playing = true; });
await p.waitForTimeout(2000);
const t2 = await p.evaluate(() => window.lab.playback.t);
check("0.05× playback", t2 > 0.03 && t2 < 0.13, `sim ${t2.toFixed(3)} s after 2 s wall`);

// Close-up (PiP) is on in the field views and shows force labels.
await at(0.25);
await p.waitForTimeout(600);
const pipLabels = await p.evaluate(() => [...document.querySelectorAll("#pip-view .arrow-label")].filter((e) => !e.hidden).map((e) => e.textContent));
check("close-up shows labelled forces", !(await p.evaluate(() => document.getElementById("pip").hidden)) && pipLabels.length >= 1, pipLabels.join(" | "));

// Flow lab at the moment of peak side force.
await p.evaluate(() => {
  window.lab.setView("flowlab");
  const m = document.querySelector(".mark--peak");
  m?.click();
});
await p.waitForTimeout(1800);
await shot(p, `${out}/flowlab-peak.png`);

// Spray (50 runs).
const sprayMs = await p.evaluate(async () => { const t0 = performance.now(); await window.lab.doSpray(); return performance.now() - t0; });
check("spray 50 runs < ~1 s", sprayMs < 1500, `${sprayMs.toFixed(0)} ms`);
await p.waitForTimeout(300);
await shot(p, `${out}/spray.png`);

// Chart click scrubs.
await p.evaluate(() => window.lab.setView("catcher"));
const box = await p.locator(".chart-body .u-over").first().boundingBox();
await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
const t3 = await p.evaluate(() => window.lab.playback.t);
const dur = await p.evaluate(() => window.lab.playback.duration);
check("chart click scrubs", Math.abs(t3 / dur - 0.75) < 0.08, `t=${t3.toFixed(3)} of ${dur.toFixed(3)}`);

// Pins, all overlays + split screen.
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
  window.lab.setView("catcher");
  window.lab.playback.speed = 0.1;
  window.lab.playback.replay();
});
await p.waitForTimeout(3000);
const ms = await p.evaluate(() => window.lab.frameMs);
console.log(`INFO  frame JS cost with every overlay + split: ${ms.toFixed(1)} ms (software GL in this harness)`);
await shot(p, `${out}/split-all-overlays.png`);
await p.evaluate(() => {
  window.lab.display.split = false;
  const o = window.lab.overlays;
  Object.keys(o.arrows).forEach((k) => (o.arrows[k] = k === "seam" || k === "drag"));
  Object.assign(o, { tripBand: false, pressure: false, smoke: false });
});

// Share link round trip.
const before = await p.evaluate(() => JSON.stringify(window.lab.params));
const hash = await p.evaluate(() => location.hash);
await p.evaluate(() => window.lab.setPaused(true)); // free the CPU for the second page
const p2 = await open(1200, 800, "dark", hash);
check("URL hash restores params", before === (await p2.evaluate(() => JSON.stringify(window.lab.params))));
await p2.context().close();
await p.evaluate(() => window.lab.setPaused(false));

// Guided tour: the card must never cover the ball.
await p.click("#tour-open");
let covered = 0;
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(1400);
  for (let k = 0; k < 4; k++) {
    const hit = await p.evaluate(() => {
      const s = document.getElementById("stage").getBoundingClientRect();
      const t = document.getElementById("tour").getBoundingClientRect();
      const b = window.lab.ballOnScreen();
      const x = s.left + b.x;
      const y = s.top + b.y;
      return x > t.left - 10 && x < t.right + 10 && y > t.top - 10 && y < t.bottom + 10;
    });
    if (hit) covered++;
    await p.waitForTimeout(250);
  }
  await shot(p, `${out}/tour-${i + 1}.png`);
  await p.click("#tour-next");
}
check("tour card never covers the ball", covered === 0, `${covered} of 20 samples covered`);
check("tour closes after the last step", await p.evaluate(() => document.getElementById("tour").hidden));

// Tooltips: hovering a chip shows its explanation with a key; an advanced control's "i" too.
await p.hover('[data-chip="ring"]');
await p.waitForTimeout(200);
const chipTip = await p.evaluate(() => { const t = document.getElementById("tip"); return t && !t.hidden ? t.textContent : ""; });
check("chip tooltip with a key", /Separation/.test(chipTip) && /Laminar/.test(chipTip), chipTip.slice(0, 60));
await shot(p, `${out}/tip-chip.png`);
await p.locator(".card").first().getByRole("tab", { name: "Advanced" }).click();
await p.locator(".card").first().locator(".card__body:not([hidden]) .info").first().hover();
await p.waitForTimeout(200);
const ctlTip = await p.evaluate(() => { const t = document.getElementById("tip"); return t && !t.hidden ? t.textContent : ""; });
check("advanced-setting tooltip", ctlTip.length > 40, ctlTip.slice(0, 60));
await shot(p, `${out}/tip-advanced.png`);
await p.mouse.move(5, 5);

// Regression: many preset changes must not exhaust WebGL contexts (blank stage).
for (let i = 0; i < 24; i++) {
  await p.locator(".preset").nth(i % 6).click();
  await p.waitForTimeout(100);
}
check("main 3D view survives 24 preset changes", !(await p.evaluate(() => document.getElementById("scene").getContext("webgl2")?.isContextLost())));
await p.evaluate(() => window.lab.loadPreset("baseball", "curveball"));
await p.evaluate(() => window.lab.setView("pitcher"));
await at(0.3);
await shot(p, `${out}/curveball-pitcher.png`);

// Volleyball.
for (const id of ["fast", "slow"]) {
  await p.evaluate((id) => window.lab.loadPreset("volleyball", id), id);
  await p.waitForTimeout(800);
}
const views2 = await p.evaluate(() => [...document.querySelectorAll("#views button")].map((b) => b.dataset.view));
for (const v of views2) {
  await p.evaluate((v) => window.lab.setView(v), v);
  await at(0.6);
  await p.waitForTimeout(1500);
  await shot(p, `${out}/volleyball-${v}.png`);
}
await p.context().close();

// Light theme, tablet.
const s = await open(1180, 820, "light");
await s.evaluate(() => { window.lab.playback.playing = false; window.lab.playback.scrub(0.35); });
await s.waitForTimeout(500);
await shot(s, `${out}/light-tablet.png`);
await s.context().close();

// Phone.
const m = await open(390, 844, "dark");
await m.screenshot({ path: `${out}/phone.png`, fullPage: true });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone: no horizontal overflow", overflow <= 0, `${overflow}px`);
await m.context().close();

console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
