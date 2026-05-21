import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom neturi ResizeObserver — Radix Select (ir kiti Radix primitives) jį
// naudoja per `@radix-ui/react-use-size`. Polifilas testams.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom taip pat neturi `Element.scrollIntoView` — Radix Select kviečia jį
// kuomet aktyvinama item. No-op stub neleidžia testams sulaužyti.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // intentionally empty
  };
}

// `hasPointerCapture` / `releasePointerCapture` ir kiti pointer events
// — Radix UI dialog'as kartais juos kviečia. jsdom jų neturi.
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture =
    function releasePointerCapture(): void {
      // intentionally empty
    };
}
