const slideSelector = "[data-slida-slide]";
const currentSelector = "[data-slida-current]";
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

  let current = showSlide(slides, parseSlideHash(window.location.hash, slides.length), window);

  const goTo = (index: number) => {
    current = showSlide(slides, index, window);
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

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", onHashChange);

  return {
    destroy() {
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
