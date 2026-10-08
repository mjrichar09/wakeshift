// Hover / focus tooltips with an optional color key. One floating element for the page;
// attach with `tip(el, content)`. Shows on mouse hover and keyboard focus; on touch, tap the
// small "i" button (`infoButton`) to toggle it.

export interface TipKey {
  /** Any CSS background (color, gradient). */
  swatch: string;
  label: string;
}

export interface TipContent {
  title: string;
  body: string;
  key?: TipKey[];
}

let el: HTMLElement | null = null;
let owner: Element | null = null;

function host(): HTMLElement {
  if (el) return el;
  el = document.createElement("div");
  el.className = "tip";
  el.setAttribute("role", "tooltip");
  el.id = "tip";
  el.hidden = true;
  document.body.appendChild(el);
  window.addEventListener("scroll", hide, true);
  // A click can re-render what is under the pointer (its pointerleave never fires).
  window.addEventListener("pointerdown", (e) => !(e.target as Element).closest?.(".info") && hide(), true);
  window.addEventListener("keydown", (e: KeyboardEvent) => e.key === "Escape" && hide());
  return el;
}

function render(c: TipContent) {
  const key = c.key?.length
    ? `<ul class="tip__key">${c.key.map((k) => `<li><i style="background:${k.swatch}"></i>${k.label}</li>`).join("")}</ul>`
    : "";
  return `<p class="tip__title">${c.title}</p><p class="tip__body">${c.body}</p>${key}`;
}

export function show(target: Element, c: TipContent) {
  const t = host();
  owner = target;
  t.innerHTML = render(c);
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const gap = 10;
  // Prefer the left of things on the right half of the screen, else the right; else below.
  let x = r.left > innerWidth / 2 ? r.left - w - gap : r.right + gap;
  let y = r.top + r.height / 2 - h / 2;
  if (x < 8 || x + w > innerWidth - 8) {
    x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    y = r.bottom + gap;
    if (y + h > innerHeight - 8) y = r.top - h - gap;
  }
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(Math.min(Math.max(8, y), innerHeight - h - 8))}px`;
}

export function hide() {
  if (el) el.hidden = true;
  owner = null;
}

export function tip(target: HTMLElement, content: TipContent | (() => TipContent)) {
  const get = () => (typeof content === "function" ? content() : content);
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") show(target, get());
  });
  target.addEventListener("pointerleave", () => owner === target && hide());
  target.addEventListener("focus", () => show(target, get()));
  target.addEventListener("blur", () => owner === target && hide());
  target.setAttribute("aria-describedby", "tip");
}

/** A small "i" button that shows the tip on hover/focus and toggles it on tap. */
export function infoButton(content: TipContent | (() => TipContent), label = "What is this?"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info";
  b.setAttribute("aria-label", label);
  b.textContent = "i";
  const get = () => (typeof content === "function" ? content() : content);
  tip(b, content);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (owner === b && el && !el.hidden) hide();
    else show(b, get());
  });
  return b;
}
