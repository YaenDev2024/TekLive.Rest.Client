<script setup lang="ts">
/**
 * PosShellView · shell del POS desktop (Fase 3 ronda 2 — réplica Flutter).
 *
 * Layout raíz de CrazyWings desktop (desktop_home_layout.dart):
 *   Row [ DesktopNavRail(80px fijo), Expanded(vista activa) ]
 *
 * - Rail PERSISTENTE entre las 4 vistas: el carrito NO se pierde al navegar
 *   (Pinia conserva el estado de cart.ts; igual que el NavigationProvider
 *   de Flutter: una sola pantalla que cambia de contenido).
 * - NavigationRail M3 (desktop_nav_rail.dart L49): bg #303030, ancho 80,
 *   labelType.all (icono 24 + label 12 SIEMPRE visible), pill indicator
 *   56×32 radius 16 deepOrange detrás del icono seleccionado.
 * - Roles (L24-29): Administrador/RestAdmin → {0,1,2,3}; CAJERO → {0,1,3}.
 *   Click sin permiso → toast "Acceso denegado para tu rol" (SnackBar).
 * - Trailing: logout (L74-87): clearSession → /login.
 */
import { computed } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { LogOut, ReceiptText, Settings, Store, Wallet } from 'lucide-vue-next'
import { clearSession, session } from '../../services/auth'
import { useToastStore } from '../../stores/toast'

const router = useRouter()
const toast = useToastStore()

/** Índice activo según la ruta (0 Vender · 1 Órdenes · 2 Ajustes · 3 Caja). */
const selectedIndex = computed<number>(() => {
  switch (router.currentRoute.value.name) {
    case 'pos-piso1':
      return 0
    case 'pos-ordenes':
      return 1
    case 'pos-ajustes':
      return 2
    case 'pos-caja':
      return 3
    default:
      return 0
  }
})

/** Réplica L24-29: destinos permitidos por rol (RestAdmin = Administrador). */
const allowed = computed<Set<number>>(() => {
  const role = (session.role ?? '').toUpperCase()
  if (role === 'ADMINISTRADOR' || role === 'RESTADMIN') {
    return new Set([0, 1, 2, 3])
  }
  if (role === 'CAJERO' || role === 'RESTCASHIER') {
    return new Set([0, 1, 3])
  }
  return new Set<number>()
})

interface RailDestination {
  index: number
  label: string
  icon: typeof Store
  to: { name: string }
  testid: string
}

const destinations: RailDestination[] = [
  { index: 0, label: 'Vender', icon: Store, to: { name: 'pos-piso1' }, testid: 'rail-vender' },
  { index: 1, label: 'Órdenes', icon: ReceiptText, to: { name: 'pos-ordenes' }, testid: 'rail-ordenes' },
  { index: 2, label: 'Ajustes', icon: Settings, to: { name: 'pos-ajustes' }, testid: 'rail-ajustes' },
  { index: 3, label: 'Caja', icon: Wallet, to: { name: 'pos-caja' }, testid: 'rail-caja' },
]

function onDestination(dest: RailDestination): void {
  if (!allowed.value.has(dest.index)) {
    // Réplica SnackBar L52-56.
    toast.error('Acceso denegado para tu rol')
    return
  }
  void router.push(dest.to)
}

/** Réplica trailing L74-87: cierra sesión → login. */
async function logout(): Promise<void> {
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="pos-shell">
    <!-- ================= DESKTOP NAV RAIL (80px) ================= -->
    <nav class="rail" data-testid="nav-rail" aria-label="Navegación del POS">
      <!-- Leading: logo (desktop_nav_rail.dart L63-66, height 40, vpadding 20) -->
      <RouterLink to="/home" class="rail-leading" aria-label="Ir al inicio">
        <img src="/logoWText.png" alt="Crazy Wings" class="rail-logo" />
      </RouterLink>

      <!-- Destinos (labelType.all: icono 24 + label 12 siempre) -->
      <div class="rail-destinations">
        <button
          v-for="dest in destinations"
          :key="dest.index"
          type="button"
          class="rail-dest"
          :class="{ 'rail-dest--active': selectedIndex === dest.index }"
          :data-testid="dest.testid"
          :aria-current="selectedIndex === dest.index ? 'page' : undefined"
          @click="onDestination(dest)"
        >
          <span class="rail-pill">
            <component :is="dest.icon" :size="24" class="rail-icon" aria-hidden="true" />
          </span>
          <span class="rail-label">{{ dest.label }}</span>
        </button>
      </div>

      <!-- Trailing: logout (L68-91, margin-top auto, padding-bottom 20) -->
      <div class="rail-trailing">
        <button
          type="button"
          class="rail-logout"
          data-testid="rail-logout"
          title="Cerrar Sesión"
          aria-label="Cerrar Sesión"
          @click="logout"
        >
          <LogOut :size="22" aria-hidden="true" />
        </button>
      </div>
    </nav>

    <!-- Vista activa: piso1 / ordenes / ajustes / caja (estado persistente) -->
    <div class="pos-shell-view">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.pos-shell {
  display: flex;
  flex-direction: row;
  height: 100vh;
  background: var(--bg);
  overflow: hidden;
}

/* NavigationRail: ancho 80 exacto, bg cardTheme (#303030), altura completa */
.rail {
  width: 80px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #303030;
  height: 100%;
}

/* Leading: logo 40px con padding vertical 20 */
.rail-leading {
  padding: 20px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rail-logo {
  height: 40px;
  width: auto;
  object-fit: contain;
}

.rail-destinations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

/* Destino: pill 56×32 radius 16 + label 12 debajo (labelType.all) */
.rail-dest {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  margin: 0 auto;
  width: 80px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--font);
}

/* Pill M3: 56×32 detrás del icono, transparente si no está seleccionado */
.rail-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 32px;
  border-radius: 16px;
  background: transparent;
  transition: background 0.15s ease;
}

.rail-dest:hover .rail-pill {
  background: rgba(255, 255, 255, 0.08);
}

.rail-dest--active .rail-pill {
  background: var(--primary); /* deepOrange #FF5722 */
}

.rail-icon {
  color: var(--text-faint); /* unselected: gris onSurfaceVariant */
  transition: color 0.15s ease;
}

.rail-dest:hover .rail-icon {
  color: var(--text);
}

.rail-dest--active .rail-icon {
  color: var(--on-primary); /* selected: blanco sobre pill */
}

.rail-label {
  font-size: 12px;
  line-height: 1;
  color: var(--text-faint);
  transition: color 0.15s ease;
}

.rail-dest--active .rail-label {
  color: var(--text);
}

/* Trailing: logout al fondo */
.rail-trailing {
  margin-top: auto;
  padding-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rail-logout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.rail-logout:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
</style>
