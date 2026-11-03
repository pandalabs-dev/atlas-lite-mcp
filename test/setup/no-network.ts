import { vi } from 'vitest';

// Unit tests must never reach the network. Only the live smoke run sets ATLAS_ALLOW_NETWORK=1.
if (process.env.ATLAS_ALLOW_NETWORK !== '1') {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network disabled in unit tests; inject a mock fetch.');
  });
}
