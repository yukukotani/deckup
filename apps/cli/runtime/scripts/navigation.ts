const slideSelector = "[data-slida-slide]";
const currentSelector = "[data-slida-current]";
const previousButtonSelector = "[data-slida-nav-prev]";
const nextButtonSelector = "[data-slida-nav-next]";
const fullscreenButtonSelector = "[data-slida-nav-fullscreen]";
const navigationMenuSelector = "[data-slida-navigation]";
const dragHandleSelector = "[data-slida-nav-drag-handle]";
const editableSelector =
  "input, textarea, select, button, [contenteditable=''], [contenteditable='true']";
const printModeAttribute = "data-slida-print";
const enterFullscreenLabel = "Enter fullscreen";
const exitFullscreenLabel = "Exit fullscreen";

type PrintSlideSnapshot = {
  slide: HTMLElement;
  hidden: HTMLElement["hidden"];
  ariaHidden: string | null;
  active: boolean;
};

export function clampSlideIndex(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), total - 1);
}

export function parseSlideHash(hash: string, total: number) {
  const normalized = hash.trim().replace(/^#\/?/, "");
  const numeric = normalized.startsWith("slide-") ? normalized.slice("slide-".length) : normalized;
  const parsed = Number.parseInt(numeric, 10);

  return Number.isFinite(parsed) ? clampSlideIndex(parsed - 1, total) : 0;
}

export function getNextSlideIndex(current: number, delta: number, total: number) {
  return clampSlideIndex(current + delta, total);
}

export function formatSlideHash(index: number) {
  return `#${index + 1}`;
}

export function clampMenuPosition(
  position: { left: number; top: number },
  viewport: { width: number; height: number },
  menu: { width: number; height: number },
) {
  return {
    left: Math.min(Math.max(position.left, 0), Math.max(viewport.width - menu.width, 0)),
    top: Math.min(Math.max(position.top, 0), Math.max(viewport.height - menu.height, 0)),
  };
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(editableSelector) !== null;
}

function updateStatus(document: Document, index: number) {
  const current = document.querySelector<HTMLElement>(currentSelector);
  if (current) {
    current.textContent = String(index + 1);
  }
}

export function showSlide(
  slides: HTMLElement[],
  index: number,
  window: Window = globalThis.window,
) {
  const nextIndex = clampSlideIndex(index, slides.length);
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === nextIndex;
    slide.hidden = !active;
    slide.setAttribute("aria-hidden", active ? "false" : "true");
    slide.toggleAttribute("data-active", active);
  });

  updateStatus(window.document, nextIndex);

  const nextHash = formatSlideHash(nextIndex);
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }

  return nextIndex;
}

export function revealSlidesForPrint(document: Document = globalThis.document) {
  const slides = Array.from(document.querySelectorAll<HTMLElement>(slideSelector));
  const snapshots: PrintSlideSnapshot[] = slides.map((slide) => ({
    slide,
    hidden: slide.hidden,
    ariaHidden: slide.getAttribute("aria-hidden"),
    active: slide.hasAttribute("data-active"),
  }));

  document.documentElement.setAttribute(printModeAttribute, "");
  document.body?.setAttribute(printModeAttribute, "");

  for (const slide of slides) {
    slide.hidden = false;
    slide.setAttribute("aria-hidden", "false");
    slide.toggleAttribute("data-active", true);
  }

  return () => {
    for (const { slide, hidden, ariaHidden, active } of snapshots) {
      slide.hidden = hidden;
      if (ariaHidden === null) {
        slide.removeAttribute("aria-hidden");
      } else {
        slide.setAttribute("aria-hidden", ariaHidden);
      }
      slide.toggleAttribute("data-active", active);
    }

    document.documentElement.removeAttribute(printModeAttribute);
    document.body?.removeAttribute(printModeAttribute);
  };
}

export function setupDeckNavigation(
  document: Document = globalThis.document,
  window: Window = globalThis.window,
) {
  const slides = Array.from(document.querySelectorAll<HTMLElement>(slideSelector));
  if (slides.length === 0) {
    return undefined;
  }

  const previousButton = document.querySelector<HTMLButtonElement>(previousButtonSelector);
  const nextButton = document.querySelector<HTMLButtonElement>(nextButtonSelector);
  const fullscreenButton = document.querySelector<HTMLButtonElement>(fullscreenButtonSelector);
  const navigationMenu = document.querySelector<HTMLElement>(navigationMenuSelector);
  const dragHandle = document.querySelector<HTMLElement>(dragHandleSelector);

  let current = showSlide(slides, parseSlideHash(window.location.hash, slides.length), window);
  let dragState:
    | { pointerId: number; offsetX: number; offsetY: number; width: number; height: number }
    | undefined;
  let restorePrintMode: (() => void) | undefined;
  let fullscreenTransitionPending = false;

  const fullscreenSupported = () =>
    document.fullscreenEnabled !== false &&
    typeof document.documentElement.requestFullscreen === "function" &&
    typeof document.exitFullscreen === "function";

  const syncFullscreenButton = () => {
    if (!fullscreenButton) return;

    const supported = fullscreenSupported();
    const active = document.fullscreenElement !== null;
    const label = active ? exitFullscreenLabel : enterFullscreenLabel;

    fullscreenButton.disabled = !supported || fullscreenTransitionPending;
    fullscreenButton.setAttribute("aria-label", label);
    fullscreenButton.setAttribute("aria-pressed", String(active));
    fullscreenButton.title = label;
  };

  const onBeforePrint = () => {
    restorePrintMode?.();
    restorePrintMode = revealSlidesForPrint(document);
  };

  const onAfterPrint = () => {
    restorePrintMode?.();
    restorePrintMode = undefined;
  };

  const syncNavigationButtons = () => {
    if (previousButton) {
      previousButton.disabled = current <= 0;
    }
    if (nextButton) {
      nextButton.disabled = current >= slides.length - 1;
    }
  };

  const goTo = (index: number) => {
    current = showSlide(slides, index, window);
    syncNavigationButtons();
  };

  const onPreviousClick = (event: MouseEvent) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, -1, slides.length));
  };

  const onNextClick = (event: MouseEvent) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, 1, slides.length));
  };

  const onFullscreenClick = async (event: MouseEvent) => {
    event.preventDefault();
    if (!fullscreenSupported() || fullscreenTransitionPending) return;

    fullscreenTransitionPending = true;
    syncFullscreenButton();

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      fullscreenButton?.focus();
    } finally {
      fullscreenTransitionPending = false;
      syncFullscreenButton();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        event.preventDefault();
        goTo(getNextSlideIndex(current, 1, slides.length));
        break;
      case "ArrowLeft":
      case "PageUp":
      case "Backspace":
        event.preventDefault();
        goTo(getNextSlideIndex(current, -1, slides.length));
        break;
      case "Home":
        event.preventDefault();
        goTo(0);
        break;
      case "End":
        event.preventDefault();
        goTo(slides.length - 1);
        break;
    }
  };

  const onHashChange = () => {
    goTo(parseSlideHash(window.location.hash, slides.length));
  };

  const applyMenuPosition = (left: number, top: number) => {
    if (!navigationMenu || !dragState) return;
    const position = clampMenuPosition(
      { left, top },
      { width: window.innerWidth, height: window.innerHeight },
      { width: dragState.width, height: dragState.height },
    );
    navigationMenu.style.left = `${position.left}px`;
    navigationMenu.style.top = `${position.top}px`;
    navigationMenu.style.right = "auto";
    navigationMenu.style.bottom = "auto";
  };

  const onDragPointerDown = (event: PointerEvent) => {
    if (!navigationMenu || dragState || event.button !== 0 || event.isPrimary === false) {
      return;
    }
    const rect = navigationMenu.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    dragHandle?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const releaseActiveDrag = () => {
    if (!dragState) return;
    dragHandle?.releasePointerCapture(dragState.pointerId);
    dragState = undefined;
  };

  const onDragPointerMove = (event: PointerEvent) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    applyMenuPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    releaseActiveDrag();
  };

  syncNavigationButtons();
  syncFullscreenButton();
  previousButton?.addEventListener("click", onPreviousClick);
  nextButton?.addEventListener("click", onNextClick);
  fullscreenButton?.addEventListener("click", onFullscreenClick);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  dragHandle?.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointermove", onDragPointerMove);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("beforeprint", onBeforePrint);
  window.addEventListener("afterprint", onAfterPrint);

  return {
    destroy() {
      onAfterPrint();
      releaseActiveDrag();
      previousButton?.removeEventListener("click", onPreviousClick);
      nextButton?.removeEventListener("click", onNextClick);
      fullscreenButton?.removeEventListener("click", onFullscreenClick);
      document.removeEventListener("fullscreenchange", syncFullscreenButton);
      dragHandle?.removeEventListener("pointerdown", onDragPointerDown);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    },
  };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setupDeckNavigation(), { once: true });
  } else {
    setupDeckNavigation();
  }
}
