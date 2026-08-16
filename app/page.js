"use client";

import { useEffect, useRef, useState } from "react";
import { GRID_SIZE, terrainAt, isNight } from "../lib/world";

const TILE = 22;

const TERRAIN_STYLE = {
  aldeia: { bg: "linear-gradient(155deg, #4a3a28 0%, #372a1c 100%)", label: "vila" },
  floresta: { bg: "linear-gradient(155deg, #1c3324 0%, #0f2117 100%)", label: "floresta" },
  rio: { bg: "linear-gradient(155deg, #2a5f78 0%, #163a4a 100%)", label: "rio" },
  planicie: { bg: "linear-gradient(155deg, #3d4a30 0%, #2c3722 100%)", label: "planície" },
};

const ACTION_ICON = {
  cortar_madeira: "🪓",
  cacar: "🏹",
  pescar: "🎣",
  beber: "💧",
  encher_cantil: "🚰",
  comer: "🍖",
  plantar: "🌱",
  colher: "🌾",
  construir: "🏗️",
  dar: "🤝",
  roubar: "🕵️",
  atacar: "⚔️",
  falar: "💬",
  confraternizar: "🔥",
  mover: "➡️",
  correr: "🏃",
  esperar: "…",
};

const STRUCTURE_ICON = {
  abrigo: "⛺",
  casa: "🏠",
  cerca: "🚧",
  fogueira: "🔥",
  poco: "⛲",
  celeiro: "🌾",
  curral: "🐄",
  viveiro: "🐟",
  horta: "🥕",
  estufa: "🪴",
  moinho: "⚙️",
  serraria: "🪚",
  ferraria: "⚒️",
  mercado: "🛒",
  armazem: "📦",
  torre_vigia: "🗼",
  farol: "🚨",
  muralha: "🧱",
  torre_guarda: "🛡️",
  hospital: "⚕️",
  templo: "⛩️",
  praca: "🪑",
  cemiterio: "⚰️",
  cais: "⚓",
};

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
  const [copyStatus, setCopyStatus] = useState(null);
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

  const night = world ? isNight(world.tick) : false;

  const tiles = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = terrainAt(x, y);
      const style = TERRAIN_STYLE[t];
      const tree = world?.trees?.[`${x},${y}`];
      const crop = world?.crops?.find((c) => c.x === x && c.y === y);
      const structure = world?.structures?.find((s) => s.x === x && s.y === y);
      tiles.push(
        <div
          key={`${x}-${y}`}
          title={`${style.label} (${x},${y})${structure ? ` — ${structure.type}` : ""}`}
          style={{
            width: TILE,
            height: TILE,
            background: style.bg,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
          }}
        >
          {t === "floresta" && tree && tree.wood > 0 ? "🌳" : ""}
          {crop ? (crop.ready ? "🌾" : "🌱") : ""}
          {structure ? STRUCTURE_ICON[structure.type] || "🏗️" : ""}
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
              background: "var(--panel)",
              border: "1px solid var(--hairline)",
              borderRadius: 12,
              padding: 14,
              display: "inline-block",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 14 }}>
                Mapa de Robotville
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <span>{night ? "🌙 noite" : "☀️ dia"}</span>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_SIZE}, ${TILE}px)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, ${TILE}px)`,
                position: "relative",
                width: GRID_SIZE * TILE,
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: "0 0 0 1px var(--hairline), 0 8px 24px rgba(0,0,0,0.35)",
              }}
            >
              {tiles}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background: "linear-gradient(155deg, rgba(20,30,55,0.38), rgba(10,14,26,0.5))",
                  opacity: night ? 1 : 0,
                  transition: "opacity 1.2s ease",
                }}
              />
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
                      opacity: a.alive ? 1 : 0.35,
                      filter: a.alive ? "none" : "grayscale(1)",
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
                        border: "2px solid rgba(0,0,0,0.45)",
                        boxShadow: `0 0 0 2px ${a.color}55, 0 2px 6px rgba(0,0,0,0.5)`,
                      }}
                    >
                      {a.name.slice(0, 2)}
                    </div>
                    {a.lastActionType && ACTION_ICON[a.lastActionType] && (
                      <div style={{ position: "absolute", top: -14, fontSize: 12, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}>
                        {ACTION_ICON[a.lastActionType]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
              {[
                { t: "floresta", note: "madeira, caça" },
                { t: "rio", note: "água, peixe" },
                { t: "aldeia", note: "centro" },
                { t: "planicie", note: "plantações" },
              ].map(({ t, note }) => (
                <div key={t} className="mono" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--muted)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: TERRAIN_STYLE[t].bg, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.3)" }} />
                  {TERRAIN_STYLE[t].label} · {note}
                </div>
              ))}
            </div>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="display" style={{ fontWeight: 700 }}>
              Registro do enxame
            </div>
            <button
              onClick={() => {
                const text = [...(world?.events || [])]
                  .reverse()
                  .map((e) => `#${e.tick} ${e.text}`)
                  .join("\n");
                navigator.clipboard
                  .writeText(text)
                  .then(() => setCopyStatus("Copiado!"))
                  .catch(() => setCopyStatus("Falhou ao copiar"));
                setTimeout(() => setCopyStatus(null), 2000);
              }}
              className="mono"
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 6,
                background: "var(--panel)",
                border: "1px solid var(--hairline)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {copyStatus || "copiar tudo"}
            </button>
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
