import React, { useState, useEffect } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  AdminPanel — El Completito Hualpén
//  · PIN de acceso
//  · Editar precios (base / premium) y disponibilidad de cada producto
//  · Ver pedidos del día (vía Firebase Function listarPedidos)
//  Los cambios de menú se guardan en Firestore (tienda/completito-hualpen)
//  y se sincronizan en tiempo real a la app del cliente.
// ════════════════════════════════════════════════════════════════════════════

// ⚠️ Reemplazar tras el primer deploy de Functions
const FN_LISTAR_PEDIDOS = "https://listarpedidos-dj7at3pwga-uc.a.run.app";

const ADMIN_PIN = "246810"; // PIN local del panel (cliente). El de listarPedidos es secret aparte.

const STORAGE_KEYS = {
  overrides: "completito_overrides", // { [id]: { base, premium, agotado } }
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ch-storage-sync", { detail: { key, value: val } }));
    }
  } catch {}
}

const C = {
  bg: "#0a0a0a", surface: "#161412", surface2: "#211d18",
  line: "rgba(247,201,72,0.14)", gold: "#F7C948", cream: "#F4E9C8",
  text: "#F5F1E8", textDim: "#9a8f7a", red: "#C0392B", ok: "#5fae6b",
};
const fmt = (n) => "$" + (n || 0).toLocaleString("es-CL");
const display = { fontFamily: "'Anton', sans-serif", letterSpacing: 0.5, textTransform: "uppercase" };
const narrow = { fontFamily: "'Archivo Narrow', sans-serif" };

// ── PIN de acceso ────────────────────────────────────────────────────────────
function PinScreen({ onSuccess, onCancel }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const press = (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) {
      if (next === ADMIN_PIN) setTimeout(onSuccess, 150);
      else { setError(true); setTimeout(() => { setPin(""); setError(false); }, 600); }
    }
  };

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...display, fontSize: 26, color: C.gold, marginBottom: 6 }}>Panel</div>
      <div style={{ fontSize: 13, color: C.textDim, marginBottom: 24 }}>Ingresa el PIN de 6 dígitos</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: "50%",
            background: pin.length > i ? (error ? C.red : C.gold) : C.surface2 }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 72px)", gap: 14 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} onClick={() => press(String(n))} style={padBtn}>{n}</button>
        ))}
        <button onClick={onCancel} style={{ ...padBtn, fontSize: 13, color: C.textDim }}>Salir</button>
        <button onClick={() => press("0")} style={padBtn}>0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} style={{ ...padBtn, fontSize: 20 }}>⌫</button>
      </div>
    </div>
  );
}

const padBtn = {
  width: 72, height: 72, borderRadius: "50%", background: C.surface,
  border: `1px solid ${C.line}`, color: C.text, fontSize: 24, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

// ════════════════════════════════════════════════════════════════════════════
//  AdminPanel principal
// ════════════════════════════════════════════════════════════════════════════
export default function AdminPanel({ onClose, menu, overrides, setOverrides }) {
  const [tab, setTab] = useState("productos"); // productos | pedidos

  // Aplica un override (precio o disponibilidad) a un producto.
  // setOverrides (pasado desde App) ya guarda local + empuja a Firestore.
  const update = (id, patch) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, maxWidth: 520, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...display, fontSize: 22, color: C.gold }}>Panel · El Completito</div>
          <button onClick={onClose} style={{ background: C.surface2, border: `1px solid ${C.line}`,
            color: C.cream, borderRadius: 10, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
            Salir
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 14px" }}>
          {[["productos", "Productos"], ["pedidos", "Pedidos del día"]].map(([k, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                background: on ? C.gold : C.surface, color: on ? "#1a1208" : C.cream,
                border: "none", borderRadius: 50, padding: "9px 18px", fontSize: 14,
                fontWeight: on ? 700 : 500, cursor: "pointer", ...narrow, letterSpacing: 1,
                textTransform: "uppercase" }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "productos"
        ? <ProductsTab menu={menu} overrides={overrides} update={update} />
        : <OrdersTab />}
    </div>
  );
}

// ── Tab Productos: precios y disponibilidad ──────────────────────────────────
function ProductsTab({ menu, overrides, update }) {
  return (
    <div style={{ padding: "16px 20px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: C.textDim }}>
        Edita precios o marca un producto como agotado. Los cambios se reflejan al instante en la app del cliente.
      </div>
      {menu.map((p) => {
        const ov = overrides[p.id] || {};
        const base = ov.base != null ? ov.base : p.base;
        const premium = ov.premium != null ? ov.premium : p.premium;
        const agotado = !!ov.agotado;
        return (
          <div key={p.id} style={{ background: C.surface, border: `1px solid ${C.line}`,
            borderRadius: 14, padding: "14px 16px", opacity: agotado ? 0.55 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ ...display, fontSize: 18, color: C.text }}>{p.nombre}</div>
              <button onClick={() => update(p.id, { agotado: !agotado })} style={{
                background: agotado ? C.red : C.surface2, color: agotado ? "#fff" : C.ok,
                border: `1px solid ${agotado ? C.red : C.line}`, borderRadius: 50,
                padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
                {agotado ? "Agotado" : "Disponible"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, margin: "4px 0 12px" }}>{p.ingredientes}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <PriceField label="Precio base" value={base}
                onChange={(v) => update(p.id, { base: v })} />
              {p.premium != null && (
                <PriceField label="Premium (ahumada)" value={premium}
                  onChange={(v) => update(p.id, { premium: v })} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PriceField({ label, value, onChange }) {
  return (
    <label style={{ flex: 1 }}>
      <div style={{ ...narrow, fontSize: 11, fontWeight: 700, color: C.cream, letterSpacing: 1.5,
        textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", background: C.surface2,
        borderRadius: 10, padding: "0 12px", border: `1px solid ${C.line}` }}>
        <span style={{ color: C.textDim, fontSize: 15 }}>$</span>
        <input type="number" inputMode="numeric" value={value}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || "0", 10)))}
          style={{ width: "100%", background: "transparent", border: "none", color: C.text,
            fontSize: 15, padding: "11px 6px", outline: "none" }} />
      </div>
    </label>
  );
}

// ── Tab Pedidos: lista del día (vía Function) ────────────────────────────────
function OrdersTab() {
  const [pin, setPin] = useState("");
  const [pedidos, setPedidos] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cargar = async (pinValue) => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${FN_LISTAR_PEDIDOS}?pin=${encodeURIComponent(pinValue)}`);
      if (r.status === 401) { setError("PIN incorrecto"); setPedidos(null); return; }
      const j = await r.json();
      setPedidos(j.result?.pedidos || []);
    } catch {
      setError("No se pudo cargar. Revisa tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  const estadoLabel = (p) => {
    if (p.pagoEstado === "aprobado") return { txt: "Pagado", color: C.ok };
    if (p.pagoEstado === "rechazado") return { txt: "Rechazado", color: C.red };
    return { txt: "Pendiente", color: C.textDim };
  };

  if (pedidos === null) {
    return (
      <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: C.textDim }}>
          Ingresa el PIN de pedidos para ver las órdenes del día.
        </div>
        <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
          placeholder="PIN de pedidos"
          style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
            padding: "14px 15px", fontSize: 16, color: C.text, outline: "none" }} />
        {error && <div style={{ fontSize: 13, color: C.red }}>{error}</div>}
        <button onClick={() => cargar(pin)} disabled={loading} style={{
          background: C.gold, border: "none", color: "#1a1208", borderRadius: 12,
          padding: "14px 0", ...display, fontSize: 15, cursor: "pointer" }}>
          {loading ? "Cargando…" : "Ver pedidos"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: C.textDim }}>{pedidos.length} pedido(s) hoy</div>
        <button onClick={() => cargar(pin)} style={{ background: C.surface2, border: `1px solid ${C.line}`,
          color: C.cream, borderRadius: 10, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
          Actualizar
        </button>
      </div>
      {pedidos.length === 0 && (
        <div style={{ textAlign: "center", color: C.textDim, padding: "30px 0", fontSize: 14 }}>
          Aún no hay pedidos hoy.
        </div>
      )}
      {pedidos.map((p) => {
        const est = estadoLabel(p);
        return (
          <div key={p.id} style={{ background: C.surface, border: `1px solid ${C.line}`,
            borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ ...display, fontSize: 20, color: C.gold }}>#{p.numero}</div>
              <span style={{ background: C.surface2, color: est.color, borderRadius: 50,
                padding: "4px 12px", fontSize: 12, fontWeight: 700, border: `1px solid ${C.line}` }}>
                {est.txt}
              </span>
            </div>
            <div style={{ fontSize: 13, color: C.cream, marginTop: 6 }}>
              {p.cliente?.nombre} {p.cliente?.apellido} · {p.cliente?.telefono}
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
              {(p.items || []).map((it, i) => (
                <div key={i} style={{ fontSize: 13, color: C.textDim }}>
                  {it.cantidad}× {it.nombre}
                  {it.personalizacion ? <span style={{ opacity: 0.7 }}> — {it.personalizacion}</span> : null}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, textAlign: "right", ...display, fontSize: 16, color: C.gold }}>
              {fmt(p.total)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { PinScreen, STORAGE_KEYS, loadJSON, saveJSON };
