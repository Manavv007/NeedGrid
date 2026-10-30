/**
 * What mock mode "uploads" every photo to (lib/cloudinary.ts): a fixed Cloudinary-style URL, because
 * the API (and the mock API) only accept photos on res.cloudinary.com. It isn't a real image; the
 * browser mock answers it with the mock arrival picture (mocks/handlers.ts), so delivery photos show
 * in mock mode.
 *
 * Its own module, with no imports, so the mock handlers can use it without loading the app's env
 * (tests that mock `@/env` must be the first to load it).
 */
export const MOCK_UPLOAD_URL = "https://res.cloudinary.com/demo/image/upload/needgrid/demo-shelf.jpg";
