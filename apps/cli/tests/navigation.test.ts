import { expect, test } from "vite-plus/test";

import {
  clampMenuPosition,
  clampSlideIndex,
  formatSlideHash,
  getNextSlideIndex,
  parseSlideHash,
  revealSlidesForPrint,
  setupDeckNavigation,
  showSlide,
} from "../runtime/scripts/navigation.ts";

function fakeSlide() {
  const attributes = new Map<string, string>();
  return {
    hidden: false,
    attributes,
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name: string) {
      return attributes.has(name);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    toggleAttribute(name: string, force?: boolean) {
      if (force) attributes.set(name, "");
      else attributes.delete(name);
    },
  } as unknown as HTMLElement & { attributes: Map<string, string> };
}

function fakeEventTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
    addEventListener: (name: string, listener: EventListener) => {
      const callbacks = listeners.get(name) ?? new Set<EventListener>();
      callbacks.add(listener);
      listeners.set(name, callbacks);
    },
    removeEventListener: (name: string, listener: EventListener) => {
      const callbacks = listeners.get(name);
      callbacks?.delete(listener);
      if (callbacks?.size === 0) listeners.delete(name);
    },
    dispatch: (name: string, event: Event) => {
      for (const listener of listeners.get(name) ?? []) {
        listener(event);
      }
    },
  };
}

function fakeButton() {
  const target = fakeEventTarget();
  const attributes = new Map<string, string>();
  return Object.assign(target, {
    disabled: false,
    title: "",
    textContent: "",
    attributes,
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    focus() {},
  }) as unknown as HTMLButtonElement &
    ReturnType<typeof fakeEventTarget> & {
      attributes: Map<string, string>;
      title: string;
      textContent: string;
    };
}

function fakeNavigationDocument<T extends object>(document: T) {
  const target = fakeEventTarget();
  return Object.assign(
    {
      documentElement: fakeSlide(),
      fullscreenElement: null,
      fullscreenEnabled: false,
    },
    document,
    {
      listeners: target.listeners,
      addEventListener: target.addEventListener,
      removeEventListener: target.removeEventListener,
      dispatch: target.dispatch,
    },
  ) as unknown as T & Document & ReturnType<typeof fakeEventTarget>;
}

function fakeDragElement(
  rect: { left?: number; top?: number; width?: number; height?: number } = {},
) {
  const target = fakeEventTarget();
  const pointerCaptures: number[] = [];
  const pointerReleases: number[] = [];
  const style: Partial<CSSStyleDeclaration> = {};
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const width = rect.width ?? 120;
  const height = rect.height ?? 40;

  return Object.assign(target, {
    pointerCaptures,
    pointerReleases,
    style,
    getBoundingClientRect() {
      return { left, top, width, height, right: left + width, bottom: top + height };
    },
    setPointerCapture(pointerId: number) {
      pointerCaptures.push(pointerId);
    },
    releasePointerCapture(pointerId: number) {
      pointerReleases.push(pointerId);
    },
  }) as unknown as HTMLElement &
    ReturnType<typeof fakeEventTarget> & {
      pointerCaptures: number[];
      pointerReleases: number[];
      style: Partial<CSSStyleDeclaration>;
    };
}

test("parseSlideHash reads numeric and slide-prefixed hashes", () => {
  expect(parseSlideHash("#1", 3)).toBe(0);
  expect(parseSlideHash("#/2", 3)).toBe(1);
  expect(parseSlideHash("#slide-3", 3)).toBe(2);
});

test("parseSlideHash falls back or clamps invalid hashes", () => {
  expect(parseSlideHash("", 3)).toBe(0);
  expect(parseSlideHash("#wat", 3)).toBe(0);
  expect(parseSlideHash("#99", 3)).toBe(2);
});

test("getNextSlideIndex keeps navigation within bounds", () => {
  expect(getNextSlideIndex(0, -1, 3)).toBe(0);
  expect(getNextSlideIndex(0, 1, 3)).toBe(1);
  expect(getNextSlideIndex(2, 1, 3)).toBe(2);
});

test("formatSlideHash uses one-based slide numbers", () => {
  expect(formatSlideHash(0)).toBe("#1");
  expect(formatSlideHash(2)).toBe("#3");
});

test("clampSlideIndex handles empty decks", () => {
  expect(clampSlideIndex(5, 0)).toBe(0);
});

test("clampMenuPosition keeps a menu within viewport bounds", () => {
  expect(
    clampMenuPosition(
      { left: -10, top: 590 },
      { width: 800, height: 600 },
      { width: 120, height: 80 },
    ),
  ).toEqual({ left: 0, top: 520 });
  expect(
    clampMenuPosition(
      { left: 900, top: -20 },
      { width: 800, height: 600 },
      { width: 120, height: 80 },
    ),
  ).toEqual({ left: 680, top: 0 });
});

test("showSlide drives self-wrapped Page sections by DOM order", () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const current = { textContent: "" };
  const location = { hash: "" };
  const window = {
    document: { querySelector: () => current },
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
  } as unknown as Window;

  expect(showSlide([first, second], 1, window)).toBe(1);
  expect(first.hidden).toBe(true);
  expect(first.attributes.get("aria-hidden")).toBe("true");
  expect(second.hidden).toBe(false);
  expect(second.attributes.get("aria-hidden")).toBe("false");
  expect(second.attributes.has("data-active")).toBe(true);
  expect(current.textContent).toBe("2");
  expect(location.hash).toBe("#2");
});

test("revealSlidesForPrint temporarily reveals all slides and restores navigation state", () => {
  const first = fakeSlide();
  const second = fakeSlide();
  first.setAttribute("aria-hidden", "false");
  first.toggleAttribute("data-active", true);
  second.hidden = true;
  second.setAttribute("aria-hidden", "true");

  const documentElement = fakeSlide();
  const body = fakeSlide();
  const document = {
    documentElement,
    body,
    querySelectorAll: () => [first, second],
  } as unknown as Document;

  const restore = revealSlidesForPrint(document);
  expect(first.hidden).toBe(false);
  expect(first.attributes.has("data-active")).toBe(true);
  expect(second.hidden).toBe(false);
  expect(second.attributes.get("aria-hidden")).toBe("false");
  expect(second.attributes.has("data-active")).toBe(true);
  expect(documentElement.attributes.has("data-deckup-print")).toBe(true);
  expect(body.attributes.has("data-deckup-print")).toBe(true);

  restore();
  expect(first.hidden).toBe(false);
  expect(first.attributes.has("data-active")).toBe(true);
  expect(first.attributes.get("aria-hidden")).toBe("false");
  expect(second.hidden).toBe(true);
  expect(second.attributes.has("data-active")).toBe(false);
  expect(second.attributes.get("aria-hidden")).toBe("true");
  expect(documentElement.attributes.has("data-deckup-print")).toBe(false);
  expect(body.attributes.has("data-deckup-print")).toBe(false);
});

test("setupDeckNavigation moves through self-wrapped Page sections with ArrowRight and ArrowLeft", () => {
  const OriginalElement = globalThis.Element;
  Object.defineProperty(globalThis, "Element", { configurable: true, value: class Element {} });
  try {
    const first = fakeSlide();
    const second = fakeSlide();
    const current = { textContent: "" };
    const document = fakeNavigationDocument({
      querySelectorAll: () => [first, second],
      querySelector: (selector: string) => (selector === "[data-deckup-current]" ? current : null),
    });
    const location = { hash: "" };
    const windowEvents = fakeEventTarget();
    const window = {
      document,
      location,
      history: {
        replaceState: (_state: unknown, _title: string, hash: string) => {
          location.hash = hash;
        },
      },
      addEventListener: windowEvents.addEventListener,
      removeEventListener: windowEvents.removeEventListener,
    } as unknown as Window;
    const navigation = setupDeckNavigation(document, window);

    windowEvents.dispatch("keydown", {
      key: "ArrowRight",
      preventDefault() {},
      target: null,
    } as unknown as KeyboardEvent);
    expect(second.attributes.has("data-active")).toBe(true);
    expect(location.hash).toBe("#2");
    windowEvents.dispatch("keydown", {
      key: "ArrowLeft",
      preventDefault() {},
      target: null,
    } as unknown as KeyboardEvent);
    expect(first.attributes.has("data-active")).toBe(true);
    expect(location.hash).toBe("#1");
    navigation?.destroy();
  } finally {
    if (OriginalElement) {
      Object.defineProperty(globalThis, "Element", { configurable: true, value: OriginalElement });
    } else {
      delete (globalThis as { Element?: unknown }).Element;
    }
  }
});

test("setupDeckNavigation syncs menu buttons with slide state", () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const previousButton = fakeButton();
  const nextButton = fakeButton();
  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-prev]") return previousButton;
      if (selector === "[data-deckup-nav-next]") return nextButton;
      return null;
    },
  });
  const location = { hash: "" };
  const window = {
    document,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  expect(previousButton.disabled).toBe(true);
  expect(nextButton.disabled).toBe(false);
  nextButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  expect(second.attributes.has("data-active")).toBe(true);
  expect(current.textContent).toBe("2");
  expect(location.hash).toBe("#2");
  expect(previousButton.disabled).toBe(false);
  expect(nextButton.disabled).toBe(true);

  previousButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  expect(first.attributes.has("data-active")).toBe(true);
  expect(current.textContent).toBe("1");
  expect(location.hash).toBe("#1");
  expect(previousButton.disabled).toBe(true);
  expect(nextButton.disabled).toBe(false);

  navigation?.destroy();
  expect(previousButton.listeners.has("click")).toBe(false);
  expect(nextButton.listeners.has("click")).toBe(false);
  expect(windowEvents.listeners.has("keydown")).toBe(false);
  expect(windowEvents.listeners.has("hashchange")).toBe(false);
});

test("setupDeckNavigation toggles fullscreen and syncs fullscreen button state", async () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const fullscreenButton = fakeButton();
  let fullscreenElement: Element | null = null;
  let requestFullscreenCalls = 0;
  let exitFullscreenCalls = 0;

  const documentElement = Object.assign(fakeSlide(), {
    async requestFullscreen() {
      requestFullscreenCalls += 1;
      fullscreenElement = documentElement as unknown as Element;
      document.dispatch("fullscreenchange", {} as Event);
    },
  }) as unknown as HTMLElement & { requestFullscreen(): Promise<void> };

  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-fullscreen]") return fullscreenButton;
      return null;
    },
  });
  Object.defineProperty(document, "documentElement", {
    configurable: true,
    value: documentElement,
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.assign(document, {
    async exitFullscreen() {
      exitFullscreenCalls += 1;
      fullscreenElement = null;
      document.dispatch("fullscreenchange", {} as Event);
    },
  });

  const location = { hash: "" };
  const window = {
    document,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  expect(fullscreenButton.disabled).toBe(false);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Enter fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");
  expect(fullscreenButton.title).toBe("Enter fullscreen");

  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  await Promise.resolve();
  expect(requestFullscreenCalls).toBe(1);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Exit fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("true");
  expect(fullscreenButton.title).toBe("Exit fullscreen");

  fullscreenElement = null;
  document.dispatch("fullscreenchange", {} as Event);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Enter fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");

  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  await Promise.resolve();
  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  await Promise.resolve();
  expect(exitFullscreenCalls).toBe(1);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Enter fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");

  navigation?.destroy();
  expect(fullscreenButton.listeners.has("click")).toBe(false);
  expect(document.listeners.has("fullscreenchange")).toBe(false);
});

test("setupDeckNavigation disables fullscreen button when Fullscreen API is unavailable", async () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const fullscreenButton = fakeButton();
  let requestFullscreenCalls = 0;
  const documentElement = Object.assign(fakeSlide(), {
    async requestFullscreen() {
      requestFullscreenCalls += 1;
    },
  }) as unknown as HTMLElement & { requestFullscreen(): Promise<void> };

  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-fullscreen]") return fullscreenButton;
      return null;
    },
  });
  Object.defineProperty(document, "documentElement", {
    configurable: true,
    value: documentElement,
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });

  const location = { hash: "" };
  const window = {
    document,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  expect(fullscreenButton.disabled).toBe(true);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Enter fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");

  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  await Promise.resolve();
  expect(requestFullscreenCalls).toBe(0);

  navigation?.destroy();
  expect(fullscreenButton.listeners.has("click")).toBe(false);
  expect(document.listeners.has("fullscreenchange")).toBe(false);
});

test("setupDeckNavigation ignores repeated fullscreen clicks while a transition is pending", async () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const fullscreenButton = fakeButton();
  let fullscreenElement: Element | null = null;
  let requestFullscreenCalls = 0;
  let finishRequest!: () => void;

  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-fullscreen]") return fullscreenButton;
      return null;
    },
  });
  const documentElement = Object.assign(fakeSlide(), {
    requestFullscreen() {
      requestFullscreenCalls += 1;
      return new Promise<void>((resolve) => {
        finishRequest = () => {
          fullscreenElement = documentElement as unknown as Element;
          document.dispatch("fullscreenchange", {} as Event);
          resolve();
        };
      });
    },
  }) as unknown as HTMLElement & { requestFullscreen(): Promise<void> };
  Object.defineProperty(document, "documentElement", {
    configurable: true,
    value: documentElement,
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.assign(document, {
    async exitFullscreen() {
      fullscreenElement = null;
      document.dispatch("fullscreenchange", {} as Event);
    },
  });

  const location = { hash: "" };
  const window = {
    document,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  expect(requestFullscreenCalls).toBe(1);
  expect(fullscreenButton.disabled).toBe(true);

  finishRequest();
  await Promise.resolve();
  expect(fullscreenButton.disabled).toBe(false);
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("true");

  navigation?.destroy();
  expect(fullscreenButton.listeners.has("click")).toBe(false);
  expect(document.listeners.has("fullscreenchange")).toBe(false);
});

test("setupDeckNavigation restores focus and state when fullscreen request rejects", async () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const fullscreenButton = fakeButton();
  let requestFullscreenCalls = 0;
  let focusCalls = 0;
  fullscreenButton.focus = () => {
    focusCalls += 1;
  };

  const documentElement = Object.assign(fakeSlide(), {
    async requestFullscreen() {
      requestFullscreenCalls += 1;
      throw new Error("denied");
    },
  }) as unknown as HTMLElement & { requestFullscreen(): Promise<void> };
  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-fullscreen]") return fullscreenButton;
      return null;
    },
  });
  Object.defineProperty(document, "documentElement", {
    configurable: true,
    value: documentElement,
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.assign(document, {
    async exitFullscreen() {},
  });

  const location = { hash: "" };
  const window = {
    document,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  fullscreenButton.dispatch("click", { preventDefault() {} } as MouseEvent);
  await Promise.resolve();
  await Promise.resolve();

  expect(requestFullscreenCalls).toBe(1);
  expect(focusCalls).toBe(1);
  expect(fullscreenButton.disabled).toBe(false);
  expect(fullscreenButton.getAttribute("aria-label")).toBe("Enter fullscreen");
  expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");

  navigation?.destroy();
  expect(fullscreenButton.listeners.has("click")).toBe(false);
  expect(document.listeners.has("fullscreenchange")).toBe(false);
});

test("setupDeckNavigation rejects secondary and non-primary drag acquisition", () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const previousButton = fakeButton();
  const nextButton = fakeButton();
  const navigationMenu = fakeDragElement({ left: 100, top: 100, width: 120, height: 80 });
  const dragHandle = fakeDragElement();
  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-prev]") return previousButton;
      if (selector === "[data-deckup-nav-next]") return nextButton;
      if (selector === "[data-deckup-navigation]") return navigationMenu;
      if (selector === "[data-deckup-nav-drag-handle]") return dragHandle;
      return null;
    },
  });
  const location = { hash: "" };
  const window = {
    document,
    innerWidth: 800,
    innerHeight: 600,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  dragHandle.dispatch("pointerdown", {
    pointerId: 11,
    button: 2,
    isPrimary: true,
    clientX: 110,
    clientY: 110,
    preventDefault() {},
  } as unknown as PointerEvent);
  dragHandle.dispatch("pointerdown", {
    pointerId: 12,
    button: 0,
    isPrimary: false,
    clientX: 110,
    clientY: 110,
    preventDefault() {},
  } as unknown as PointerEvent);
  windowEvents.dispatch("pointermove", {
    pointerId: 11,
    clientX: 500,
    clientY: 500,
    preventDefault() {},
  } as PointerEvent);
  windowEvents.dispatch("pointermove", {
    pointerId: 12,
    clientX: 500,
    clientY: 500,
    preventDefault() {},
  } as PointerEvent);

  expect(dragHandle.pointerCaptures).toEqual([]);
  expect(dragHandle.pointerReleases).toEqual([]);
  expect(navigationMenu.style.left).toBeUndefined();
  expect(navigationMenu.style.top).toBeUndefined();

  navigation?.destroy();
});

test("setupDeckNavigation drags the menu from the handle within viewport bounds", () => {
  const first = fakeSlide();
  const second = fakeSlide();
  const windowEvents = fakeEventTarget();
  const current = { textContent: "" };
  const previousButton = fakeButton();
  const nextButton = fakeButton();
  const navigationMenu = fakeDragElement({ left: 700, top: 550, width: 120, height: 80 });
  const dragHandle = fakeDragElement();
  const document = fakeNavigationDocument({
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => {
      if (selector === "[data-deckup-current]") return current;
      if (selector === "[data-deckup-nav-prev]") return previousButton;
      if (selector === "[data-deckup-nav-next]") return nextButton;
      if (selector === "[data-deckup-navigation]") return navigationMenu;
      if (selector === "[data-deckup-nav-drag-handle]") return dragHandle;
      return null;
    },
  });
  const location = { hash: "" };
  const window = {
    document,
    innerWidth: 800,
    innerHeight: 600,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, hash: string) => {
        location.hash = hash;
      },
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  } as unknown as Window;
  const navigation = setupDeckNavigation(document, window);

  expect(previousButton.listeners.has("pointerdown")).toBe(false);
  windowEvents.dispatch("pointermove", {
    pointerId: 7,
    clientX: 900,
    clientY: 700,
    preventDefault() {},
  } as PointerEvent);
  expect(navigationMenu.style.left).toBeUndefined();

  dragHandle.dispatch("pointerdown", {
    pointerId: 7,
    button: 0,
    isPrimary: true,
    clientX: 710,
    clientY: 560,
    preventDefault() {},
  } as unknown as PointerEvent);
  dragHandle.dispatch("pointerdown", {
    pointerId: 8,
    button: 0,
    isPrimary: true,
    clientX: 720,
    clientY: 570,
    preventDefault() {},
  } as unknown as PointerEvent);
  expect(dragHandle.pointerCaptures).toEqual([7]);
  windowEvents.dispatch("pointermove", {
    pointerId: 8,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  } as PointerEvent);
  expect(navigationMenu.style.left).toBeUndefined();

  windowEvents.dispatch("pointermove", {
    pointerId: 7,
    clientX: 900,
    clientY: 700,
    preventDefault() {},
  } as PointerEvent);
  expect(navigationMenu.style.left).toBe("680px");
  expect(navigationMenu.style.top).toBe("520px");
  expect(navigationMenu.style.right).toBe("auto");
  expect(navigationMenu.style.bottom).toBe("auto");
  expect(navigationMenu.style.transform).toBe("none");

  windowEvents.dispatch("pointercancel", { pointerId: 7 } as PointerEvent);
  expect(dragHandle.pointerReleases).toEqual([7]);
  windowEvents.dispatch("pointermove", {
    pointerId: 7,
    clientX: 20,
    clientY: 20,
    preventDefault() {},
  } as PointerEvent);
  expect(navigationMenu.style.left).toBe("680px");
  expect(navigationMenu.style.top).toBe("520px");

  dragHandle.dispatch("pointerdown", {
    pointerId: 9,
    button: 0,
    isPrimary: true,
    clientX: 710,
    clientY: 560,
    preventDefault() {},
  } as unknown as PointerEvent);
  navigation?.destroy();
  expect(dragHandle.pointerReleases).toEqual([7, 9]);
  expect(dragHandle.listeners.has("pointerdown")).toBe(false);
  expect(windowEvents.listeners.has("pointermove")).toBe(false);
  expect(windowEvents.listeners.has("pointerup")).toBe(false);
  expect(windowEvents.listeners.has("pointercancel")).toBe(false);
});

test("setupDeckNavigation keeps keyboard guards and hash sync aligned with menu buttons", () => {
  const OriginalElement = globalThis.Element;
  class FakeElement {
    closest() {
      return this;
    }
  }
  Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
  try {
    const first = fakeSlide();
    const second = fakeSlide();
    const windowEvents = fakeEventTarget();
    const current = { textContent: "" };
    const previousButton = fakeButton();
    const nextButton = fakeButton();
    const navigationMenu = fakeDragElement({ width: 120, height: 40 });
    const dragHandle = fakeDragElement();
    const document = fakeNavigationDocument({
      querySelectorAll: () => [first, second],
      querySelector: (selector: string) => {
        if (selector === "[data-deckup-current]") return current;
        if (selector === "[data-deckup-nav-prev]") return previousButton;
        if (selector === "[data-deckup-nav-next]") return nextButton;
        if (selector === "[data-deckup-navigation]") return navigationMenu;
        if (selector === "[data-deckup-nav-drag-handle]") return dragHandle;
        return null;
      },
    });
    const location = { hash: "" };
    const window = {
      document,
      innerWidth: 800,
      innerHeight: 600,
      location,
      history: {
        replaceState: (_state: unknown, _title: string, hash: string) => {
          location.hash = hash;
        },
      },
      addEventListener: windowEvents.addEventListener,
      removeEventListener: windowEvents.removeEventListener,
    } as unknown as Window;
    const navigation = setupDeckNavigation(document, window);

    location.hash = "#2";
    windowEvents.dispatch("hashchange", {} as Event);
    expect(second.attributes.has("data-active")).toBe(true);
    expect(current.textContent).toBe("2");
    expect(previousButton.disabled).toBe(false);
    expect(nextButton.disabled).toBe(true);

    windowEvents.dispatch("keydown", {
      key: "ArrowLeft",
      preventDefault() {
        throw new Error("keyboard event from a button should be ignored");
      },
      target: new FakeElement(),
    } as unknown as KeyboardEvent);

    expect(second.attributes.has("data-active")).toBe(true);
    expect(current.textContent).toBe("2");
    expect(location.hash).toBe("#2");

    navigation?.destroy();
  } finally {
    if (OriginalElement) {
      Object.defineProperty(globalThis, "Element", { configurable: true, value: OriginalElement });
    } else {
      delete (globalThis as { Element?: unknown }).Element;
    }
  }
});
