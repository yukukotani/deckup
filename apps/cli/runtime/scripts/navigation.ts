const slideSelector = "[data-slida-slide]";
const currentSelector = "[data-slida-current]";
const previousButtonSelector = "[data-slida-nav-prev]";
const nextButtonSelector = "[data-slida-nav-next]";
const navigationMenuSelector = "[data-slida-navigation]";
const dragHandleSelector = "[data-slida-nav-drag-handle]";
const editableSelector =
  "input, textarea, select, button, [contenteditable=''], [contenteditable='true']";

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
  const navigationMenu = document.querySelector<HTMLElement>(navigationMenuSelector);
  const dragHandle = document.querySelector<HTMLElement>(dragHandleSelector);

  let current = showSlide(slides, parseSlideHash(window.location.hash, slides.length), window);
  let dragState:
    | { pointerId: number; offsetX: number; offsetY: number; width: number; height: number }
    | undefined;

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
  previousButton?.addEventListener("click", onPreviousClick);
  nextButton?.addEventListener("click", onNextClick);
  dragHandle?.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointermove", onDragPointerMove);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", onHashChange);

  return {
    destroy() {
      releaseActiveDrag();
      previousButton?.removeEventListener("click", onPreviousClick);
      nextButton?.removeEventListener("click", onNextClick);
      dragHandle?.removeEventListener("pointerdown", onDragPointerDown);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hashchange", onHashChange);
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
