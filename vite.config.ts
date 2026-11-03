import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// TekLive Rest · devUrl 1423 (1420-1422 occupied by other TekLive clients —
// plan v2 decision #6). Tauri devUrl must match: see src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 1423,
    strictPort: true,
  },
  clearScreen: false,
})
