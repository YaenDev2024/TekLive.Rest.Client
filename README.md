# TekLive Rest Client

Cliente de POS y gestión de restaurante para TekLive (Fase 2 — scaffold).

**Stack**: Vue 3 + TypeScript strict + Vite (puerto 1423) · vue-router 4 ·
lucide-vue-next · Tauri 2 (desktop Windows) · Capacitor 6 (Android, shell
pospuesto) · CSS variables (sin Tailwind).

## Arranque

```powershell
npm install
npm run dev        # http://localhost:1423 (strictPort)
npm run build      # vue-tsc + vite build
```

Requiere la API BusinessSuite corriendo (default `http://127.0.0.1:5171`).
Configurar con `.env` (ver `.env.example`):

- `VITE_API_BASE_URL` — base del backend.
- `VITE_APP_API_KEY` — X-Api-Key del módulo Rest (`RestAppApiKey`).

## Flujo de autenticación

1. **Activación** (dueño): `POST /api/saas/auth/loginApp` con `LICENSE_KEY` →
   JWT de licencia. El backend **no** devuelve companyId en el body; el cliente
   lo resuelve del claim `CompanyId` del JWT y lo persiste.
2. **Login empleado**: `POST /api/rest/auth/login` con
   `{ companyId, employeeNumber, password, deviceId, ... }`.
3. El **access token vive solo en memoria** (nunca localStorage). En
   localStorage solo hay datos no sensibles: `rest.companyId`,
   `rest.employeeNumber`, `rest.displayName`, `rest.role`, `rest.deviceId`,
   `rest.licenseKey`.

## Tauri (desktop)

```powershell
cd src-tauri
cargo check        # validar toolchain
npm run tauri build  # instalador NSIS (Fase 5)
```

## Pendientes (documentados)

- `npx cap add android` — requiere JDK 17 (la máquina tiene Java 1.8).
- Updater desktop/APK — Fase 5 (`/api/rest/desktop/updates/`,
  `/api/rest/android/updates/`, ya exentos de X-Api-Key y LicenseGuard en el
  backend).
- Tests unitarios — Fase 3+.
- PWA service worker — Fase 5.
