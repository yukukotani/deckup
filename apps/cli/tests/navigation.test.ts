import { expect, test } from "vite-plus/test";

import {
  clampSlideIndex,
  formatSlideHash,
  getNextSlideIndex,
  parseSlideHash,
  setupDeckNavigation,
  showSlide,
} from "../runtime/scripts/navigation.ts";

function fakeSlide() {
  const attributes = new Map<string, string>();
  return {
    hidden: false,
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    toggleAttribute(name: string, force?: boolean) {
      if (force) attributes.set(name, "");
      else attributes.delete(name);
    },
  } as unknown as HTMLElement & { attributes: Map<string, string> };
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

test("setupDeckNavigation moves through self-wrapped Page sections with ArrowRight and ArrowLeft", () => {
  const OriginalElement = globalThis.Element;
  Object.defineProperty(globalThis, "Element", { configurable: true, value: class Element {} });
  try {
    const first = fakeSlide();
    const second = fakeSlide();
    const listeners = new Map<string, EventListener>();
    const current = { textContent: "" };
    const document = {
      querySelectorAll: () => [first, second],
      querySelector: () => current,
    } as unknown as Document;
    const location = { hash: "" };
    const window = {
      document,
      location,
      history: {
        replaceState: (_state: unknown, _title: string, hash: string) => {
          location.hash = hash;
        },
      },
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Window;
    const navigation = setupDeckNavigation(document, window);

    listeners.get("keydown")?.({
      key: "ArrowRight",
      preventDefault() {},
      target: null,
    } as unknown as KeyboardEvent);
    expect(second.attributes.has("data-active")).toBe(true);
    expect(location.hash).toBe("#2");
    listeners.get("keydown")?.({
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
