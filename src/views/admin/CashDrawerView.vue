<script setup lang="ts">
/**
 * CashDrawerView · pantalla CAJA del rail (Fase 3 ronda 2 — placeholder fiel).
 *
 * Réplica del estado SIN SESIÓN de lib/screens/admin/cash_drawer_screen.dart
 * (L486-500): AppBar "Arqueo y Cierre de Caja" (bg estándar grey[850]) +
 * contenido centrado "No hay sesión de caja activa."
 * La funcionalidad real de arqueo llega en Fase 3d (TODO(cash-round-2)).
 */
</script>

<template>
  <div class="cash">
    <!-- AppBar (bg estándar grey[850] como las demás AppBars de Flutter) -->
    <header class="cash-appbar" data-testid="cash-appbar">
      <h1 class="cash-appbar-title">Arqueo y Cierre de Caja</h1>
    </header>

    <!-- Estado sin sesión activa (L496-500, EXACTO) -->
    <div class="cash-empty" data-testid="cash-empty">
      <p>No hay sesión de caja activa.</p>
    </div>
  </div>
</template>

<style scoped>
.cash {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg); /* grey[900] scaffold */
}

.cash-appbar {
  padding: 14px 16px;
  background: var(--bg-surface); /* grey[850] */
}

.cash-appbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

/* Center(child: Text('No hay sesión de caja activa.')) */
.cash-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.cash-empty p {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}
</style>
