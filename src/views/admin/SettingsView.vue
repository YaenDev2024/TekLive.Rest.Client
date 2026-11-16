<script setup lang="ts">
/**
 * SettingsView · pantalla AJUSTES del rail (Fase 3 ronda 2; ajustada
 * 2026-11-14 por decisión del dueño).
 *
 * Réplica de lib/screens/admin/settings.dart (SettingsAdming):
 * - Scaffold bg #212121, AppBar "Ajustes" con bg del scaffold.
 * - ListView con UN SOLO tile (el personal solo configura la impresora de
 *   su máquina aquí — "Precio del dólar", "Crear Nuevo Producto" y
 *   "Configuración del ticket" se retiraron de esta pantalla; el ticket-
 *   config sigue disponible vía API y sus flags aplican a los tickets):
 *   Icons.print_outlined → "Impresora de Tickets"
 *   subtitle "Busca y configura tu impresora de red"
 *   → /ajustes/impresoras (ronda Piso 1: PrintersView réplica
 *     printer_settings_screen.dart).
 */
import { useRouter } from 'vue-router'
import { Printer } from 'lucide-vue-next'

const router = useRouter()

function openPrinters(): void {
  void router.push('/ajustes/impresoras')
}
</script>

<template>
  <div class="set">
    <!-- AppBar "Ajustes" (bg del scaffold, réplica settings.dart L11-14) -->
    <header class="set-appbar" data-testid="settings-appbar">
      <h1 class="set-appbar-title">Ajustes</h1>
    </header>

    <!-- ListView con ListTiles (L15-42 del original; solo impresora) -->
    <ul class="set-list" data-testid="settings-list">
      <li>
        <button type="button" class="set-tile" data-testid="settings-printer" @click="openPrinters">
          <Printer :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Impresora de Tickets</span>
            <span class="set-tile-subtitle">Busca y configura tu impresora de red</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.set {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg); /* var(--bg) */
}

/* AppBar con bg del scaffold (Theme.of(context).scaffoldBackgroundColor) */
.set-appbar {
  padding: 22px 24px 12px;
  background: var(--bg);

  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.set-appbar-title {
  margin: 0;
  font-size: var(--text-h1);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-1);
}

/* Lista alineada al mismo eje del appbar (evita el título centrado con
   tiles pegados al rail) */
.set-list {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0 24px 32px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Fila-card: superficie propia, icono-tile neutro, chevron de affordance */
.set-tile {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 64px;
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

@media (hover: hover) {
  .set-tile:hover {
    border-color: var(--border);
    background: var(--surface-hover);
  }
}

.set-tile:active {
  transform: scale(0.995);
}

.set-tile-icon {
  flex: none;
  color: var(--text-2);
}

.set-tile-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.set-tile-title {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.set-tile-subtitle {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.set-tile::after {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  margin-left: 4px;
  border-right: 1.5px solid var(--text-3);
  border-bottom: 1.5px solid var(--text-3);
  transform: rotate(-45deg);
}

@media (max-width: 640px) {
  .set-appbar {
    padding: 18px 16px 10px;
  }

  .set-list {
    padding: 0 16px 24px;
  }
}
</style>
