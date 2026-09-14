export const CANVAS_SCROLL_ID = "opend-canvas-scroll";
export const CANVAS_VIEW_PAD_X = 80;
export const CANVAS_VIEW_PAD_Y = 80;
export const FIT_ZOOM_SLACK = 0.03;

export function computeFitScale(
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
  padX = CANVAS_VIEW_PAD_X,
  padY = CANVAS_VIEW_PAD_Y,
): number {
  const availW = Math.max(viewW - padX, 1);
  const availH = Math.max(viewH - padY, 1);
  if (canvasW <= 0 || canvasH <= 0) return 1;
  return Math.min(availW / canvasW, availH / canvasH, 1);
}

export function zoomIsAtFit(zoom: number, fit: number, slack = FIT_ZOOM_SLACK): boolean {
  if (fit <= 0) return true;
  return zoom <= fit + slack;
}

export type ScrollPos = { scrollLeft: number; scrollTop: number };
export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };

/** Keep `target` (content coordinates) inside the scroller. If it is larger than the view, show as much as possible without jumping when already overlapping. */
export function nextScrollToReveal(
  view: Size,
  scroll: ScrollPos,
  target: Rect,
  margin = 16,
): ScrollPos {
  let sl = scroll.scrollLeft;
  let st = scroll.scrollTop;
  const viewLeft = sl;
  const viewRight = sl + view.width;
  const viewTop = st;
  const viewBottom = st + view.height;
  const tLeft = target.left;
  const tRight = target.left + target.width;
  const tTop = target.top;
  const tBottom = target.top + target.height;

  if (target.width + margin * 2 >= view.width) {
    const overlapsX = tRight > viewLeft && tLeft < viewRight;
    if (!overlapsX) sl = tLeft - margin;
  } else if (tLeft - margin < viewLeft) {
    sl = tLeft - margin;
  } else if (tRight + margin > viewRight) {
    sl = tRight + margin - view.width;
  }

  if (target.height + margin * 2 >= view.height) {
    const overlapsY = tBottom > viewTop && tTop < viewBottom;
    if (!overlapsY) st = tTop - margin;
  } else if (tTop - margin < viewTop) {
    st = tTop - margin;
  } else if (tBottom + margin > viewBottom) {
    st = tBottom + margin - view.height;
  }

  return { scrollLeft: Math.max(0, sl), scrollTop: Math.max(0, st) };
}

export function restoreWindowScroll() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.scrollTop || root.scrollLeft) {
    root.scrollTop = 0;
    root.scrollLeft = 0;
  }
  if (document.body.scrollTop || document.body.scrollLeft) {
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

export function canvasScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(CANVAS_SCROLL_ID);
}

export function revealPageInScroller(pageId: string | null | undefined, behavior: ScrollBehavior = "auto") {
  if (!pageId) return;
  const wrapper = canvasScroller();
  if (!wrapper) return;
  const pageEl = wrapper.querySelector(`[data-page-id="${pageId}"]`);
  if (!(pageEl instanceof HTMLElement)) return;
  const wr = wrapper.getBoundingClientRect();
  const er = pageEl.getBoundingClientRect();
  const next = nextScrollToReveal(
    { width: wr.width, height: wr.height },
    { scrollLeft: wrapper.scrollLeft, scrollTop: wrapper.scrollTop },
    {
      left: er.left - wr.left + wrapper.scrollLeft,
      top: er.top - wr.top + wrapper.scrollTop,
      width: er.width,
      height: er.height,
    },
  );
  if (
    Math.abs(next.scrollLeft - wrapper.scrollLeft) < 1 &&
    Math.abs(next.scrollTop - wrapper.scrollTop) < 1
  ) {
    return;
  }
  wrapper.scrollTo({ left: next.scrollLeft, top: next.scrollTop, behavior });
}
