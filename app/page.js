"use client";

import { useEffect, useRef, useState } from "react";

const GRID_SIZE = 16;
const TILE = 26;

const TERRAIN_STYLE = {
  aldeia: { bg: "#3a2e22", label: "vila" },
  floresta: { bg: "#152a1d", label: "floresta" },
  rio: { bg: "#1f4a5c", label: "rio" },
  planicie: { bg: "#333d29", label: "planície" },
};

const ACTION_ICON = {
  cortar_madeira: "🪓",
  cacar: "🏹",
  beber: "💧",
  encher_cantil: "🚰",
  comer: "🍖",
  plantar: "🌱",
  colher: "🌾",
  dar: "🤝",
  roubar: "🕵️",
  atacar: "⚔️",
  falar: "💬",
  mover: "➡️",
  esperar: "…",
};

function terrainAt(x, y) {
  if (x <= 2 && y <= 2) return "floresta";
  if (x >= 13 && y >= 13) return "rio";
  if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return "aldeia";
  return "planicie";
}

function Bar({ value, color }) {
  return (
    <div className="bar-bg">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export default function Home() {
  const [world, setWorld] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setWorld(data);
        setError(null);
      } catch (e) {
        setError(String(e.message || e));
      }
    }
    poll();
    timerRef.current = setInterval(poll, 6000);
    return () => clearInterval(timerRef.current);
  }, []);

  const tiles = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = terrainAt(x, y);
      const style = TERRAIN_STYLE[t];
      const tree = world?.trees?.[`${x},${y}`];
      const crop = world?.crops?.find((c) => c.x === x && c.y === y);
      tiles.push(
        <div
          key={`${x}-${y}`}
          title={`${style.label} (${x},${y})`}
          style={{
            width: TILE,
            height: TILE,
            background: style.bg,
            border: "1px solid rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
          }}
        >
          {t === "floresta" && tree && tree.wood > 0 ? "🌳" : ""}
          {crop ? (crop.ready ? "🌾" : "🌱") : ""}
        </div>
      );
    }
  }

  const tileGroups = {};
  (world?.agents || []).forEach((a) => {
    const key = `${a.x},${a.y}`;
    tileGroups[key] = tileGroups[key] || [];
    tileGroups[key].push(a.id);
  });
  const OFFSETS = [
    { dx: 0, dy: 0 },
    { dx: 9, dy: -9 },
    { dx: -9, dy: 9 },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--hairline)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div className="display" style={{ fontSize: 22, fontWeight: 700 }}>
            ROBOTVILLE
          </div>
          <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
            três agentes autônomos, três provedores de IA, uma vila de sobrevivência
          </div>
        </div>
        <div className="mono" style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>
          {world ? `ciclo ${world.tick}` : "carregando..."}
          {error && <div style={{ color: "var(--danger)" }}>erro: {error}</div>}
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 20, padding: 20 }}>
        <section style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${GRID_SIZE}, ${TILE}px)`,
              gridTemplateRows: `repeat(${GRID_SIZE}, ${TILE}px)`,
              position: "relative",
              width: GRID_SIZE * TILE,
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--hairline)",
            }}
          >
            {tiles}
            {world?.agents?.map((a) => {
              const key = `${a.x},${a.y}`;
              const group = tileGroups[key] || [a.id];
              const idx = group.indexOf(a.id);
              const off = OFFSETS[idx % OFFSETS.length];
              return (
              <div
                key={a.id}
                title={`${a.name} — ${a.lastAction || ""}`}
                style={{
                  position: "absolute",
                  left: a.x * TILE + off.dx,
                  top: a.y * TILE + off.dy,
                  width: TILE,
                  height: TILE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "left 0.6s ease, top 0.6s ease",
                  opacity: a.alive ? 1 : 0.3,
                }}
              >
                <div
                  className="mono"
                  style={{
                    width: 22,
                    height: 18,
                    borderRadius: 9,
                    background: a.color,
                    color: "#111",
                    fontSize: 8,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px solid rgba(0,0,0,0.4)",
                  }}
                >
                  {a.name.slice(0, 2)}
                </div>
                {a.lastActionType && ACTION_ICON[a.lastActionType] && (
                  <div style={{ position: "absolute", top: -14, fontSize: 12 }}>{ACTION_ICON[a.lastActionType]}</div>
                )}
              </div>
              );
            })}
          </div>
          <div className="mono" style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
            🌳 floresta (madeira) · canto superior-esquerdo &nbsp;|&nbsp; 🚰 rio · canto inferior-direito &nbsp;|&nbsp; vila ao centro
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260, flex: "1 1 260px" }}>
          {world?.agents?.map((a) => (
            <div
              key={a.id}
              style={{
                background: "var(--panel)",
                border: `1px solid ${a.alive ? "var(--hairline)" : "var(--danger)"}`,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="display" style={{ fontWeight: 700, color: a.color }}>
                  {a.name} {!a.alive && "☠️"}
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                  ({a.x},{a.y})
                </div>
              </div>
              <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--muted)", margin: "6px 0" }}>
                "{a.lastThought}"
              </div>
              <div style={{ fontSize: 11, marginBottom: 8 }}>{a.lastAction}</div>
              <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                <div className="mono" style={{ fontSize: 10 }}>
                  HP {a.hp}
                </div>
                <Bar value={a.hp} color="var(--danger)" />
                <div className="mono" style={{ fontSize: 10 }}>
                  fome {a.hunger}
                </div>
                <Bar value={a.hunger} color="var(--copper)" />
                <div className="mono" style={{ fontSize: 10 }}>
                  sede {a.thirst}
                </div>
                <Bar value={a.thirst} color="var(--cyan)" />
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                🍞{a.inventory.pao} 💧{a.inventory.agua} 🌰{a.inventory.sementes} 🪵{a.inventory.madeira} 🥩
                {a.inventory.carne} 🪓{a.inventory.machado}
              </div>
            </div>
          ))}
        </section>

        <section style={{ flex: "1 1 260px", minWidth: 260 }}>
          <div className="display" style={{ fontWeight: 700, marginBottom: 8 }}>
            Registro do enxame
          </div>
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
              padding: 12,
              maxHeight: 480,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {world?.events?.map((e, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                <span style={{ color: "var(--cyan)" }}>#{e.tick}</span> {e.text}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
