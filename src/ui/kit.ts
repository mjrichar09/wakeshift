// A small control kit for the cards: slider rows with an editable value, segmented
// controls, toggles, selects, buttons and two dials. Every control reads its value through
// `get` and writes through `set`, and `refresh()` re-reads after outside changes.

import type { TipContent } from "./tip";
import { infoButton } from "./tip";

/** Explanatory tooltip for a control: plain text (titled with the label) or full content. */
export type Tip = string | TipContent;

function info(label: string, t?: Tip): HTMLElement[] {
  if (!t) return [];
  const content = typeof t === "string" ? { title: label, body: t } : t;
  return [infoButton(content, `About ${label}`)];
}

export interface Control {
  el: HTMLElement;
  refresh(): void;
}

let uid = 0;
const id = (p: string) => `${p}-${++uid}`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface SliderOpts {
  label: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  /** Small text under the slider, re-read on refresh (e.g. "0.25 turns to the plate"). */
  hint?: () => string;
  tip?: Tip;
}

export function slider(o: SliderOpts): Control {
  const row = h("div", "ctl ctl--slider");
  const sid = id("s");
  const head = h("div", "ctl__head");
  const label = h("label", "ctl__label", o.label);
  label.htmlFor = sid;
  const labelBox = h("span", "ctl__labelbox");
  labelBox.append(label, ...info(o.label, o.tip));
  const valWrap = h("span", "ctl__value");
  const num = h("input");
  num.type = "number";
  num.step = String(o.step);
  num.min = String(o.min);
  num.max = String(o.max);
  num.setAttribute("aria-label", `${o.label} value`);
  valWrap.append(num);
  if (o.unit) valWrap.append(h("span", "ctl__unit", o.unit));
  head.append(labelBox, valWrap);
  const range = h("input", "ctl__range");
  range.type = "range";
  range.id = sid;
  range.min = String(o.min);
  range.max = String(o.max);
  range.step = String(o.step);
  const hint = o.hint ? h("p", "ctl__hint") : null;
  row.append(head, range);
  if (hint) row.append(hint);
  const digits = o.digits ?? Math.max(0, -Math.floor(Math.log10(o.step) + 1e-9));
  const paint = () => {
    const v = o.get();
    range.value = String(v);
    if (document.activeElement !== num) num.value = v.toFixed(digits);
    const k = (v - o.min) / (o.max - o.min);
    range.style.setProperty("--fill", `${Math.max(0, Math.min(1, k)) * 100}%`);
    if (hint) hint.textContent = o.hint!();
  };
  range.addEventListener("input", () => {
    o.set(+range.value);
    paint();
  });
  num.addEventListener("change", () => {
    const v = Math.max(o.min, Math.min(o.max, +num.value));
    if (Number.isFinite(v)) o.set(v);
    paint();
  });
  paint();
  return { el: row, refresh: paint };
}

export interface SegOpts<T extends string | number> {
  label?: string;
  options: { value: T; label: string; title?: string }[];
  get: () => T;
  set: (v: T) => void;
  tip?: Tip;
}

export function seg<T extends string | number>(o: SegOpts<T>): Control {
  const row = h("div", "ctl ctl--seg");
  if (o.label) {
    const lb = h("span", "ctl__labelbox");
    lb.append(h("span", "ctl__label", o.label), ...info(o.label, o.tip));
    row.append(lb);
  }
  const group = h("div", "seg");
  group.setAttribute("role", "radiogroup");
  if (o.label) group.setAttribute("aria-label", o.label);
  const btns = o.options.map((op) => {
    const b = h("button", "", op.label);
    b.type = "button";
    b.setAttribute("role", "radio");
    if (op.title) b.title = op.title;
    b.addEventListener("click", () => {
      o.set(op.value);
      paint();
    });
    group.append(b);
    return b;
  });
  row.append(group);
  const paint = () => btns.forEach((b, i) => b.setAttribute("aria-checked", String(o.options[i].value === o.get())));
  paint();
  return { el: row, refresh: paint };
}

export function toggle(o: { label: string; get: () => boolean; set: (v: boolean) => void; hint?: string; tip?: Tip }): Control {
  const row = h("label", "ctl ctl--toggle");
  const input = h("input");
  input.type = "checkbox";
  const track = h("span", "toggle__track");
  track.setAttribute("aria-hidden", "true");
  const text = h("span", "ctl__label", o.label + (o.hint ? ` <small>${o.hint}</small>` : ""));
  row.append(input, track, text, ...info(o.label, o.tip));
  input.addEventListener("change", () => o.set(input.checked));
  const paint = () => (input.checked = o.get());
  paint();
  return { el: row, refresh: paint };
}

export function select<T extends string | number>(o: SegOpts<T> & { label: string }): Control {
  const row = h("div", "ctl ctl--select");
  const sid = id("sel");
  const label = h("label", "ctl__label", o.label);
  label.htmlFor = sid;
  const s = h("select");
  s.id = sid;
  for (const op of o.options) {
    const opt = h("option", "", op.label);
    opt.value = String(op.value);
    s.append(opt);
  }
  s.addEventListener("change", () => {
    const op = o.options.find((x) => String(x.value) === s.value);
    if (op) o.set(op.value);
  });
  row.append(label, s);
  const paint = () => (s.value = String(o.get()));
  paint();
  return { el: row, refresh: paint };
}

export function button(label: string, onClick: () => void, variant: "" | "quiet" = ""): HTMLButtonElement {
  const b = h("button", `btn${variant ? ` btn--${variant}` : ""}`, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export function readout(label: string, get: () => string, t?: Tip): Control {
  const row = h("div", "ctl ctl--readout");
  const v = h("span", "ctl__readout");
  const lb = h("span", "ctl__labelbox");
  lb.append(h("span", "ctl__label", label), ...info(label, t));
  row.append(lb, v);
  const paint = () => (v.textContent = get());
  paint();
  return { el: row, refresh: paint };
}

export function note(text: string): HTMLElement {
  return h("p", "card__note", text);
}

// ------------------------------------------------------------------ dials

/**
 * Dial geometry (pure, tested). Angles in degrees, screen coordinates with y DOWN.
 *  - "clock": the spin-tilt clock as the catcher/passer sees it: 0° = up (12 o'clock),
 *    90° = right = +x (1B / passer's right). The needle is the Magnus push direction.
 *  - "compass": the wind seen from above with the pitcher/server at the TOP: the needle
 *    is where the wind blows to; 0° = toward the plate/passer (down the screen),
 *    90° = toward +x (right of the screen).
 */
export type DialKind = "clock" | "compass";

export function dialVector(kind: DialKind, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return kind === "clock" ? [Math.sin(a), -Math.cos(a)] : [Math.sin(a), Math.cos(a)];
}

export function dialAngle(kind: DialKind, sx: number, sy: number): number {
  const a = kind === "clock" ? Math.atan2(sx, -sy) : Math.atan2(sx, sy);
  return (((a * 180) / Math.PI) % 360 + 360) % 360;
}

export interface DialOpts {
  label: string;
  kind: DialKind;
  get: () => number;
  set: (deg: number) => void;
  /** Labels at top, right, bottom, left of the face. */
  marks: [string, string, string, string];
  format: (deg: number) => string;
  /** Snap step while dragging, degrees. */
  step?: number;
  tip?: Tip;
}

export function dial(o: DialOpts): Control {
  const row = h("div", "ctl ctl--dial");
  const face = h("div", "dial");
  face.tabIndex = 0;
  face.setAttribute("role", "slider");
  face.setAttribute("aria-label", o.label);
  face.setAttribute("aria-valuemin", "0");
  face.setAttribute("aria-valuemax", "359");
  const R = 44;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const [x, y] = dialVector("clock", i * 30);
    const r0 = i % 3 ? R - 5 : R - 9;
    return `<line x1="${x * r0}" y1="${y * r0}" x2="${x * R}" y2="${y * R}" class="dial__tick"/>`;
  }).join("");
  const [t, r, b, l] = o.marks;
  face.innerHTML = `<svg viewBox="-64 -64 128 128" aria-hidden="true">
    <circle r="${R}" class="dial__face"/>${ticks}
    <text x="0" y="-52" class="dial__mark">${t}</text><text x="56" y="4" class="dial__mark" text-anchor="start">${r}</text>
    <text x="0" y="60" class="dial__mark">${b}</text><text x="-56" y="4" class="dial__mark" text-anchor="end">${l}</text>
    <line class="dial__needle" x1="0" y1="0" x2="0" y2="0"/><circle class="dial__tip" r="5"/><circle r="3.5" class="dial__hub"/></svg>`;
  const needle = face.querySelector(".dial__needle") as SVGLineElement;
  const tip = face.querySelector(".dial__tip") as SVGCircleElement;
  const val = h("span", "ctl__readout");
  const head = h("div", "ctl__head");
  const lb = h("span", "ctl__labelbox");
  lb.append(h("span", "ctl__label", o.label), ...info(o.label, o.tip));
  head.append(lb, val);
  row.append(head, face);
  const paint = () => {
    const d = o.get();
    const [x, y] = dialVector(o.kind, d);
    needle.setAttribute("x2", String(x * (R - 6)));
    needle.setAttribute("y2", String(y * (R - 6)));
    tip.setAttribute("cx", String(x * (R - 6)));
    tip.setAttribute("cy", String(y * (R - 6)));
    face.setAttribute("aria-valuenow", String(Math.round(d)));
    face.setAttribute("aria-valuetext", o.format(d));
    val.textContent = o.format(d);
  };
  const step = o.step ?? 5;
  const fromPointer = (e: PointerEvent) => {
    const rc = face.getBoundingClientRect();
    const a = dialAngle(o.kind, e.clientX - (rc.left + rc.width / 2), e.clientY - (rc.top + rc.height / 2));
    o.set((Math.round(a / step) * step) % 360);
    paint();
  };
  face.addEventListener("pointerdown", (e) => {
    face.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  face.addEventListener("pointermove", (e) => {
    if (face.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  face.addEventListener("keydown", (e) => {
    const k = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 45, PageDown: -45 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    o.set((((o.get() + k) % 360) + 360) % 360);
    paint();
  });
  paint();
  return { el: row, refresh: paint };
}

// ------------------------------------------------------------------ cards

export interface CardOpts {
  title: string;
  basic: (Control | HTMLElement)[];
  advanced?: (Control | HTMLElement)[];
  /** Short chip in the header (e.g. a live value). */
  chip?: () => string;
}

export interface Card extends Control {
  setChip(): void;
}

/** A card with Basic / Advanced tabs (tabs only when there is an advanced section). */
export function card(o: CardOpts): Card {
  const el = h("section", "card");
  const head = h("header", "card__head");
  const title = h("h3", "", o.title);
  head.append(title);
  const chip = o.chip ? h("span", "chip") : null;
  if (chip) head.append(chip);
  el.append(head);
  const controls: Control[] = [];
  const mount = (items: (Control | HTMLElement)[], into: HTMLElement) => {
    for (const it of items) {
      if (it instanceof HTMLElement) into.append(it);
      else {
        controls.push(it);
        into.append(it.el);
      }
    }
  };
  const basic = h("div", "card__body");
  mount(o.basic, basic);
  if (o.advanced?.length) {
    const tabs = h("div", "tabs");
    tabs.setAttribute("role", "tablist");
    const adv = h("div", "card__body");
    adv.hidden = true;
    mount(o.advanced, adv);
    const mk = (label: string, panel: HTMLElement, on: boolean) => {
      const b = h("button", "tab", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(on));
      b.addEventListener("click", () => {
        for (const x of tabs.querySelectorAll("button")) x.setAttribute("aria-selected", String(x === b));
        basic.hidden = panel !== basic;
        adv.hidden = panel !== adv;
      });
      tabs.append(b);
    };
    mk("Basic", basic, true);
    mk("Advanced", adv, false);
    head.append(tabs);
    el.append(basic, adv);
  } else el.append(basic);
  const setChip = () => {
    if (chip) chip.textContent = o.chip!();
  };
  setChip();
  return {
    el,
    refresh() {
      controls.forEach((c) => c.refresh());
      setChip();
    },
    setChip,
  };
}
