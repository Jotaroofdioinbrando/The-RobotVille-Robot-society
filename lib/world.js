// Mundo de Robotville: grade, terrenos, recursos e estado inicial.

export const GRID_SIZE = 16;
export const VISION_RADIUS = 4; // até onde um agente enxerga
export const TREE_MAX_WOOD = 3;
export const TREE_REGEN_TICKS = 25;
export const CROP_GROWTH_TICKS = 18;
export const WATER_CAPACITY = 4;
export const HUNGER_THIRST_DECAY = 4;

// Zonas: vila no centro, floresta no canto superior-esquerdo (longe),
// rio no canto inferior-direito (longe). Resto é planície.
export function terrainAt(x, y) {
  if (x <= 2 && y <= 2) return "floresta";
  if (x >= 13 && y >= 13) return "rio";
  if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return "aldeia";
  return "planicie";
}

export function isForest(x, y) {
  return terrainAt(x, y) === "floresta";
}
export function isRiver(x, y) {
  return terrainAt(x, y) === "rio";
}
export function isPlain(x, y) {
  return terrainAt(x, y) === "planicie";
}

export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function clampGrid(v) {
  return Math.max(0, Math.min(GRID_SIZE - 1, v));
}

function initialTrees() {
  const trees = {};
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (isForest(x, y)) trees[`${x},${y}`] = { wood: TREE_MAX_WOOD, regenAt: null };
    }
  }
  return trees;
}

const AGENT_SEEDS = [
  { id: "cerebras", name: "CEREBRAS", color: "#FF8A3D", provider: "cerebras", startX: 7, startY: 7 },
  { id: "groq", name: "GROQ", color: "#9B7BFF", provider: "groq", startX: 8, startY: 7 },
  { id: "gemini", name: "GEMINI", color: "#4285F4", provider: "gemini", startX: 7, startY: 8 },
];

export function initialWorld() {
  const now = Date.now();
  return {
    tick: 0,
    createdAt: now,
    updatedAt: now,
    agents: AGENT_SEEDS.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      provider: a.provider,
      x: a.startX,
      y: a.startY,
      hp: 100,
      hunger: 100,
      thirst: 100,
      alive: true,
      inventory: { machado: 1, pao: 2, agua: 2, sementes: 3, madeira: 0, carne: 0 },
      lastThought: "Acabei de chegar em Robotville. Preciso entender onde estou.",
      lastAction: "chegou à vila",
      lastActionType: "esperar",
      lastActionTargetXY: null,
      memory: { knownAgents: {}, rumors: [] },
    })),
    trees: initialTrees(),
    crops: [],
    events: [{ tick: 0, text: "Robotville começou a existir: três agentes, um machado cada, dois pães, duas garrafas de água e algumas sementes." }],
  };
}
