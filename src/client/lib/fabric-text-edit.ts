import type { Canvas, IText } from "fabric";
import { canvasScroller, restoreWindowScroll } from "./canvas-viewport";

let editingCount = 0;
let guardInstalled = false;
let windowScrollBound = false;

function onWindowScroll() {
  if (editingCount > 0) restoreWindowScroll();
}

function bindWindowScroll() {
  if (windowScrollBound || typeof window === "undefined") return;
  windowScrollBound = true;
  window.addEventListener("scroll", onWindowScroll, true);
}

function unbindWindowScroll() {
  if (!windowScrollBound || editingCount > 0) return;
  windowScrollBound = false;
  window.removeEventListener("scroll", onWindowScroll, true);
}

function freezeScroller() {
  const el = canvasScroller();
  const left = el?.scrollLeft ?? 0;
  const top = el?.scrollTop ?? 0;
  const restore = () => {
    restoreWindowScroll();
    if (!el) return;
    el.scrollLeft = left;
    el.scrollTop = top;
  };
  restore();
  requestAnimationFrame(restore);
  window.setTimeout(restore, 50);
}

function pinHiddenTextarea(target: { hiddenTextarea?: HTMLTextAreaElement | null } | null | undefined) {
  const ta = target?.hiddenTextarea;
  if (!ta) return;
  try {
    ta.focus({ preventScroll: true });
  } catch {
    ta.focus();
  }
}

function onFocusIn(e: FocusEvent) {
  const t = e.target;
  if (!(t instanceof HTMLTextAreaElement)) return;
  if (t.getAttribute("data-fabric") !== "textarea") return;
  freezeScroller();
}

export function ensureFabricTextareaGuard() {
  if (guardInstalled || typeof document === "undefined") return;
  guardInstalled = true;
  document.addEventListener("focusin", onFocusIn, true);
}

export function installTextEditScrollLock(canvas: Canvas) {
  ensureFabricTextareaGuard();
  canvas.on("text:editing:entered", (opt) => {
    editingCount += 1;
    bindWindowScroll();
    pinHiddenTextarea(opt.target as IText);
    freezeScroller();
  });
  canvas.on("text:editing:exited", () => {
    editingCount = Math.max(0, editingCount - 1);
    restoreWindowScroll();
    unbindWindowScroll();
  });
}
