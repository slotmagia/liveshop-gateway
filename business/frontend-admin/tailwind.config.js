import preset from '@liveshop/design-tokens/tailwind-preset'

/**
 * The console reads its scales from the shared preset, so this file only
 * declares where classes are written. `host-runtime` is scanned from source
 * because the shell and the UI primitives it ships are part of this bundle.
 */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../packages/host-runtime/src/**/*.{ts,tsx}',
  ],
}
