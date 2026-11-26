import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// TekLive Rest · devUrl 1423 (1420-1422 occupied by other TekLive clients —
// plan v2 decision #6). Tauri devUrl must match: see src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [vue()],
  build: {
    // Vite 8 usa "baseline-widely-available" por defecto, que asume soporte de
    // media queries range ("(width<=699px)"). El WebView del APK (Chromium
    // viejo en Android) NO las entiende: se ignoran en silencio y el rail de
    // escritorio se queda visible junto al bottom nav, con el grid cortado.
    // safari14 compila a la sintaxis clasica "(max-width:699px)" en todo el
    // bundle, que es lo que ya corre en el web y en el desktop.
    target: ['safari14', 'chrome94'],
    cssTarget: ['safari14', 'chrome94'],
  },
  server: {
    port: 1423,
    strictPort: true,
  },
  clearScreen: false,
})
