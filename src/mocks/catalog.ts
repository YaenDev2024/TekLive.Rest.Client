/**
 * TekLive Rest · MOCK de catálogo POS Piso 1 (Fase 3a).
 *
 * Fixture demo REALISTA para desarrollo visual y QA mientras el backend
 * implementa GET /api/rest/catalog. Réplica del catálogo de CrazyWings:
 * Hamburguesas / Alitas / Bebidas / Extras con option groups dinámicos
 * (tamaño/término con min/max), regla condicional y extras/complementos.
 *
 * QA (ronda 3): el switch mock→API real es `USE_MOCK` en src/stores/catalog.ts
 * (una sola línea por store). Este archivo NO se importa desde componentes.
 */

import type { Catalog } from '../api/pos-types'

/** Catálogo demo: 4 categorías, 8 templates, extras, complementos, salsas. */
export const MOCK_CATALOG: Catalog = {
  categories: [
    { id: 1, name: 'Hamburguesas' },
    { id: 2, name: 'Alitas' },
    { id: 3, name: 'Bebidas' },
    { id: 4, name: 'Extras' },
  ],

  templates: [
    // --- Hamburguesas -------------------------------------------------------
    {
      id: 101,
      name: 'Crazy Burger',
      basePrice: 55,
      categoryId: 1,
      hasImage: true,
      optionGroups: [
        {
          id: 1,
          name: 'Término de carne',
          minSelect: 1,
          maxSelect: 1,
          values: [
            { id: 11, name: 'Término medio', price: 0 },
            { id: 12, name: 'Bien cocida', price: 0 },
          ],
        },
        {
          id: 2,
          name: 'Papas acompañantes',
          minSelect: 0,
          maxSelect: 2,
          values: [
            { id: 21, name: 'Papas gajo', price: 0 },
            { id: 22, name: 'Papas a la francesa', price: 0 },
            { id: 23, name: 'Aros de cebolla', price: 12 },
          ],
        },
      ],
      conditionalRules: [],
    },
    {
      id: 102,
      name: 'Doble Smash',
      basePrice: 78,
      categoryId: 1,
      hasImage: true,
      optionGroups: [
        {
          id: 3,
          name: 'Término de carne',
          minSelect: 1,
          maxSelect: 1,
          values: [
            { id: 31, name: 'Término medio', price: 0 },
            { id: 32, name: 'Bien cocida', price: 0 },
          ],
        },
      ],
      conditionalRules: [],
    },
    {
      id: 103,
      name: 'Combo Ensalada',
      basePrice: 65,
      categoryId: 1,
      hasImage: false,
      // Regla condicional demo: el grupo "Salsa extra" SOLO aparece si
      // el usuario eligió el valor "Pollo" en "Proteína" (acción SHOW,
      // minúsculas + triggerValueId — mismo shape que el backend real).
      // triggerValueId 41 = Pollo.
      optionGroups: [
        {
          id: 4,
          name: 'Proteína',
          minSelect: 1,
          maxSelect: 1,
          values: [
            { id: 41, name: 'Pollo', price: 0 },
            { id: 42, name: 'Boneless', price: 15 },
          ],
        },
        {
          id: 5,
          name: 'Salsa extra',
          minSelect: 0,
          maxSelect: 1,
          values: [
            { id: 51, name: 'Ranch', price: 8 },
            { id: 52, name: 'BBQ', price: 8 },
          ],
        },
      ],
      conditionalRules: [
        { id: 1, triggerGroupId: 4, triggerValueId: 41, targetGroupId: 5, action: 'show' },
      ],
    },

    // --- Alitas ---------------------------------------------------------------
    {
      id: 201,
      name: 'Alitas 6 pzas',
      basePrice: 95,
      categoryId: 2,
      hasImage: true,
      optionGroups: [
        {
          id: 6,
          name: 'Sabor',
          minSelect: 1,
          maxSelect: 2,
          values: [
            { id: 61, name: 'BBQ', price: 0 },
            { id: 62, name: 'Búfalo', price: 0 },
            { id: 63, name: 'Mango habanero', price: 0 },
            { id: 64, name: 'Limon pepper', price: 0 },
          ],
        },
      ],
      conditionalRules: [],
    },
    {
      id: 202,
      name: 'Boneless 250g',
      basePrice: 89,
      categoryId: 2,
      hasImage: false,
      optionGroups: [
        {
          id: 7,
          name: 'Sabor',
          minSelect: 1,
          maxSelect: 1,
          values: [
            { id: 71, name: 'BBQ', price: 0 },
            { id: 72, name: 'Búfalo', price: 0 },
            { id: 73, name: 'Parmesano', price: 10 },
          ],
        },
      ],
      conditionalRules: [],
    },

    // --- Bebidas ---------------------------------------------------------------
    {
      id: 301,
      name: 'Refresco 600ml',
      basePrice: 25,
      categoryId: 3,
      hasImage: false,
      optionGroups: [],
      conditionalRules: [],
    },
    {
      id: 302,
      name: 'Cerveza artesanal',
      basePrice: 70,
      categoryId: 3,
      hasImage: true,
      optionGroups: [
        {
          id: 8,
          name: 'Tipo',
          minSelect: 1,
          maxSelect: 1,
          values: [
            { id: 81, name: 'IPA', price: 0 },
            { id: 82, name: 'Stout', price: 5 },
            { id: 83, name: 'Lager', price: 0 },
          ],
        },
      ],
      conditionalRules: [],
    },
    {
      id: 303,
      name: 'Limonada natural',
      basePrice: 35,
      categoryId: 3,
      hasImage: false,
      optionGroups: [],
      conditionalRules: [],
    },

    // --- Extras (templates sueltos) ---------------------------------------------
    {
      id: 401,
      name: 'Papas gajo extra',
      basePrice: 45,
      categoryId: 4,
      hasImage: false,
      optionGroups: [],
      conditionalRules: [],
    },
  ],

  extras: [
    { id: 1, name: 'Tocino extra', price: 15 },
    { id: 2, name: 'Queso cheddar extra', price: 12 },
    { id: 3, name: 'Jalapeño', price: 8 },
    { id: 4, name: 'Cebolla caramelizada', price: 10 },
  ],

  complements: {
    headers: [
      { id: 1, name: 'Acompañamiento' },
      { id: 2, name: 'Aderezo' },
    ],
    details: [
      { id: 1, headerId: 1, name: 'Papas a la francesa', price: 0 },
      { id: 2, headerId: 1, name: 'Ensalada', price: 0 },
      { id: 3, headerId: 2, name: 'Ranch', price: 0 },
      { id: 4, headerId: 2, name: 'Chipotle', price: 5 },
    ],
  },

  salsas: [
    { id: 1, name: 'Búfalo' },
    { id: 2, name: 'BBQ' },
    { id: 3, name: 'Mango habanero' },
    { id: 4, name: 'Tamarindo' },
  ],
}
