import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library can't register its own cleanup.
afterEach(cleanup);

// jsdom has no layout: the chat scrolls to its last message with this.
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {} });
}
