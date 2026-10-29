// Every VITE_* value is PUBLIC: it is baked into the bundle. Never put secrets here.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_PAYPAL_CLIENT_ID?: string;
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string;
  readonly VITE_DEMO_STAFF_KEY?: string;
  readonly VITE_AG_STUDIO_LICENSE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
