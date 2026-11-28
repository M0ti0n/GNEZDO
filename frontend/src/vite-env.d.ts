/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" = talk to the GNEZDO server; anything else = built-in sample data. */
  readonly VITE_USE_API?: string;
  /** Set by the test build (windows-build.yml): its name from CHANGES.md ("Build 28 Nov 2026, 1"), when it
   *  was made (ISO time) and the commit. Missing: a page built by hand (Settings → About: development build). */
  readonly VITE_BUILD_NAME?: string;
  readonly VITE_BUILD_TIME?: string;
  readonly VITE_BUILD_SHA?: string;
}
