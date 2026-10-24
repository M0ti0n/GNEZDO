/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" = talk to the GNEZDO server; anything else = built-in sample data. */
  readonly VITE_USE_API?: string;
}
