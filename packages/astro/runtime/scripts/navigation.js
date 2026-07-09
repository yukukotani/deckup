const slideSelector = "[data-deckup-slide]";
const currentSelector = "[data-deckup-current]";
const previousButtonSelector = "[data-deckup-nav-prev]";
const nextButtonSelector = "[data-deckup-nav-next]";
const fullscreenButtonSelector = "[data-deckup-nav-fullscreen]";
const navigationMenuSelector = "[data-deckup-navigation]";
const dragHandleSelector = "[data-deckup-nav-drag-handle]";
const editableSelector =
  "input, textarea, select, button, [contenteditable=''], [contenteditable='true']";
const printModeAttribute = "data-deckup-print";
const enterFullscreenLabel = "Enter fullscreen";
const exitFullscreenLabel = "Exit fullscreen";

function clampSlideIndex(index, total) {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

function parseSlideHash(hash, total) {
  const normalized = hash.trim().replace(/^#\/?/, "");
  const numeric = normalized.startsWith("slide-") ? normalized.slice("slide-".length) : normalized;
  const parsed = Number.parseInt(numeric, 10);
  return Number.isFinite(parsed) ? clampSlideIndex(parsed - 1, total) : 0;
}

function getNextSlideIndex(current, delta, total) {
  return clampSlideIndex(current + delta, total);
}

function formatSlideHash(index) {
  return `#${index + 1}`;
}

function clampMenuPosition(position, viewport, menu) {
  return {
    left: Math.min(Math.max(position.left, 0), Math.max(viewport.width - menu.width, 0)),
    top: Math.min(Math.max(position.top, 0), Math.max(viewport.height - menu.height, 0)),
  };
}

function isEditableTarget(target) {
  return target instanceof Element && target.closest(editableSelector) !== null;
}

function updateStatus(document, index) {
  const current = document.querySelector(currentSelector);
  if (current) current.textContent = String(index + 1);
}

function showSlide(slides, index, window = globalThis.window) {
  const nextIndex = clampSlideIndex(index, slides.length);
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === nextIndex;
    slide.hidden = !active;
    slide.setAttribute("aria-hidden", active ? "false" : "true");
    slide.toggleAttribute("data-active", active);
  });
  updateStatus(window.document, nextIndex);
  const nextHash = formatSlideHash(nextIndex);
  if (window.location.hash !== nextHash) window.history.replaceState(null, "", nextHash);
  return nextIndex;
}

function revealSlidesForPrint(document = globalThis.document) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  const snapshots = slides.map((slide) => ({
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
      if (ariaHidden === null) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", ariaHidden);
      slide.toggleAttribute("data-active", active);
    }
    document.documentElement.removeAttribute(printModeAttribute);
    document.body?.removeAttribute(printModeAttribute);
  };
}

function setupDeckNavigation(document = globalThis.document, window = globalThis.window) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  if (slides.length === 0) return undefined;
  const previousButton = document.querySelector(previousButtonSelector);
  const nextButton = document.querySelector(nextButtonSelector);
  const fullscreenButton = document.querySelector(fullscreenButtonSelector);
  const navigationMenu = document.querySelector(navigationMenuSelector);
  const dragHandle = document.querySelector(dragHandleSelector);
  let current = showSlide(slides, parseSlideHash(window.location.hash, slides.length), window);
  let dragState;
  let restorePrintMode;
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
  const syncNavigationButtons = () => {
    if (previousButton) previousButton.disabled = current <= 0;
    if (nextButton) nextButton.disabled = current >= slides.length - 1;
  };
  const goTo = (index) => {
    current = showSlide(slides, index, window);
    syncNavigationButtons();
  };
  previousButton?.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, -1, slides.length));
  });
  nextButton?.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, 1, slides.length));
  });
  fullscreenButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!fullscreenSupported() || fullscreenTransitionPending) return;
    fullscreenTransitionPending = true;
    syncFullscreenButton();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenButton?.focus();
    } finally {
      fullscreenTransitionPending = false;
      syncFullscreenButton();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;
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
  });
  window.addEventListener("hashchange", () =>
    goTo(parseSlideHash(window.location.hash, slides.length)),
  );
  window.addEventListener("beforeprint", () => {
    restorePrintMode?.();
    restorePrintMode = revealSlidesForPrint(document);
  });
  window.addEventListener("afterprint", () => {
    restorePrintMode?.();
    restorePrintMode = undefined;
  });
  dragHandle?.addEventListener("pointerdown", (event) => {
    if (!navigationMenu || dragState || event.button !== 0 || event.isPrimary === false) return;
    const rect = navigationMenu.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (!navigationMenu || !dragState || event.pointerId !== dragState.pointerId) return;
    const position = clampMenuPosition(
      { left: event.clientX - dragState.offsetX, top: event.clientY - dragState.offsetY },
      { width: window.innerWidth, height: window.innerHeight },
      { width: dragState.width, height: dragState.height },
    );
    navigationMenu.style.left = `${position.left}px`;
    navigationMenu.style.top = `${position.top}px`;
    navigationMenu.style.right = "auto";
    navigationMenu.style.bottom = "auto";
    navigationMenu.style.transform = "none";
    event.preventDefault();
  });
  const endDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragHandle?.releasePointerCapture(dragState.pointerId);
    dragState = undefined;
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  syncNavigationButtons();
  syncFullscreenButton();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setupDeckNavigation(), { once: true });
  else setupDeckNavigation();
}
