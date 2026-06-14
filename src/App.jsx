import React, { useState, useEffect, useMemo, useRef } from "react";
import AdminPanel, { PinScreen, STORAGE_KEYS, loadJSON, saveJSON } from "./AdminPanel.jsx";
import { firebasePush, firebasePull, firebaseSubscribe } from "./firebase.js";

// ════════════════════════════════════════════════════════════════════════════
//  EL COMPLETITO HUALPÉN — Pedido online (pago con TUU)
//  Arquitectura basada en el proyecto KIOSK·IQ, adaptada a:
//   · compra desde el celular (no tótem)
//   · datos del cliente antes de pagar (requisito de TUU)
//   · pasarela TUU Pago Online vía Firebase Functions
// ════════════════════════════════════════════════════════════════════════════

// ── Endpoints de las Firebase Functions ──────────────────────────────────────
// ⚠️ Reemplazar tras el primer deploy (firebase deploy --only functions imprime las URLs).
const FN_INICIAR_PAGO     = "https://iniciarpago-dj7at3pwga-uc.a.run.app";
const FN_CONSULTAR_PEDIDO = "https://consultarpedido-dj7at3pwga-uc.a.run.app";

// ── Paleta (derivada del cartel de El Completito) ────────────────────────────
const C = {
  bg:       "#0a0a0a",
  surface:  "#161412",
  surface2: "#211d18",
  line:     "rgba(247,201,72,0.14)",
  gold:     "#F7C948",
  goldDeep: "#E0A82E",
  cream:    "#F4E9C8",
  text:     "#F5F1E8",
  textDim:  "#9a8f7a",
  red:      "#C0392B",
  ok:       "#5fae6b",
};

const fmt = (n) => "$" + (n || 0).toLocaleString("es-CL");

// ── Menú de El Completito ────────────────────────────────────────────────────
const MENU = [
  { id: 1,  cat: "Completos", nombre: "Con Todo",      ingredientes: "Chucrut, tomate, palta, mayonesa", base: 3500, premium: 4200 },
  { id: 2,  cat: "Completos", nombre: "Tradicional",   ingredientes: "Chucrut, mayonesa",                 base: 3000, premium: 3800 },
  { id: 3,  cat: "Completos", nombre: "Alemán",        ingredientes: "Chucrut, tomate, mayonesa",         base: 3500, premium: 4200 },
  { id: 4,  cat: "Completos", nombre: "Italiano",      ingredientes: "Tomate, palta, mayonesa",           base: 3500, premium: 4200 },
  { id: 5,  cat: "Completos", nombre: "Palta",         ingredientes: "Palta, mayonesa",                   base: 3500, premium: 4200 },
  { id: 6,  cat: "Completos", nombre: "Chucrut Palta", ingredientes: "Chucrut, palta, mayonesa",          base: 3500, premium: 4200 },
  { id: 7,  cat: "Completos", nombre: "Tomate",        ingredientes: "Tomate, mayonesa",                  base: 3500, premium: 4200 },
  { id: 8,  cat: "Completos", nombre: "Especial",      ingredientes: "Salchicha, mayonesa",               base: 2000, premium: 2800 },
  { id: 20, cat: "Bebidas",   nombre: "Bebida",        ingredientes: "Lata / botella individual",         base: 1200, premium: null },
  { id: 21, cat: "Bebidas",   nombre: "Té",            ingredientes: "Bolsita, agua caliente",            base: 1200, premium: null },
  { id: 22, cat: "Bebidas",   nombre: "Café",          ingredientes: "Café del momento",                  base: 1200, premium: null },
  { id: 23, cat: "Bebidas",   nombre: "Milo",          ingredientes: "Caliente, espumoso",                base: 1200, premium: null },
];

const CATEGORIES = ["Completos", "Bebidas"];

function optionGroupsFor(p) {
  const groups = [];
  if (p.premium != null) {
    groups.push({
      label: "Salchicha", type: "single",
      options: [
        { name: "Doble Salchicha Tradicional", extra: 0 },
        { name: "Ahumada Sureña Premium", extra: p.premium - p.base },
      ],
    });
    groups.push({
      label: "Agregados", type: "multi",
      options: [
        { name: "Choclo", extra: 1200 },
        { name: "Tocino", extra: 1200 },
      ],
    });
  }
  return groups;
}

const S = {
  screen: { minHeight: "100dvh", background: C.bg, color: C.text, maxWidth: 520, margin: "0 auto", position: "relative" },
  display: { fontFamily: "'Anton', sans-serif", letterSpacing: 0.5, textTransform: "uppercase" },
  narrow:  { fontFamily: "'Archivo Narrow', sans-serif" },
};

// ════════════════════════════════════════════════════════════════════════════
//  OptionsModal — selección de salchicha, agregados y cantidad
// ════════════════════════════════════════════════════════════════════════════
function OptionsModal({ product, onClose, onConfirm }) {
  const groups = useMemo(() => optionGroupsFor(product), [product]);
  // single -> índice seleccionado ; multi -> set de índices
  const [single, setSingle] = useState(() => {
    const init = {};
    groups.forEach((g, gi) => { if (g.type === "single") init[gi] = 0; });
    return init;
  });
  const [multi, setMulti] = useState(() => {
    const init = {};
    groups.forEach((g, gi) => { if (g.type === "multi") init[gi] = new Set(); });
    return init;
  });
  const [qty, setQty] = useState(1);

  const selected = [];
  groups.forEach((g, gi) => {
    if (g.type === "single") {
      const opt = g.options[single[gi]] || g.options[0];
      selected.push({ group: g.label, name: opt.name, extra: opt.extra || 0 });
    } else {
      [...(multi[gi] || [])].forEach((oi) => {
        const opt = g.options[oi];
        if (opt) selected.push({ group: g.label, name: opt.name, extra: opt.extra || 0 });
      });
    }
  });

  const extraTotal = selected.reduce((s, o) => s + (o.extra || 0), 0);
  const unit = product.base + extraTotal;
  const totalPrice = unit * qty;

  const optionKey = selected.length
    ? selected.map((o) => `${o.group}:${o.name}`).join("|")
    : "base";

  const toggleMulti = (gi, oi) => {
    setMulti((prev) => {
      const next = new Set(prev[gi]);
      next.has(oi) ? next.delete(oi) : next.add(oi);
      return { ...prev, [gi]: next };
    });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 5000,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: "22px 22px 0 0", width: "100%", maxWidth: 520,
        maxHeight: "92dvh", overflowY: "auto", borderTop: `3px solid ${C.gold}`,
        boxShadow: "0 -12px 40px rgba(0,0,0,0.6)", paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {/* Cabecera */}
        <div style={{ padding: "20px 20px 0", position: "relative" }}>
          <button onClick={onClose} aria-label="Cerrar" style={{
            position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: "50%",
            background: C.surface2, border: `1px solid ${C.line}`, color: C.cream, fontSize: 18, cursor: "pointer",
          }}>×</button>
          <div style={{ ...S.display, fontSize: 30, color: C.gold, lineHeight: 1 }}>{product.nombre}</div>
          <div style={{ fontSize: 14, color: C.textDim, marginTop: 8 }}>{product.ingredientes}</div>
        </div>

        <div style={{ padding: "18px 20px 0" }}>
          {groups.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 22 }}>
              <div style={{ ...S.narrow, fontSize: 13, fontWeight: 700, color: C.cream, letterSpacing: 2,
                textTransform: "uppercase", marginBottom: 10 }}>
                {g.label}{g.type === "multi" && <span style={{ color: C.textDim, fontWeight: 500 }}> · opcional</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.options.map((opt, oi) => {
                  const on = g.type === "single" ? single[gi] === oi : (multi[gi] && multi[gi].has(oi));
                  return (
                    <button key={oi}
                      onClick={() => g.type === "single"
                        ? setSingle((p) => ({ ...p, [gi]: oi }))
                        : toggleMulti(gi, oi)}
                      style={{
                        background: on ? C.gold : C.surface2,
                        border: on ? `2px solid ${C.gold}` : `2px solid transparent`,
                        color: on ? "#1a1208" : C.text,
                        borderRadius: 12, padding: "11px 16px", fontSize: 14, cursor: "pointer",
                        fontWeight: on ? 700 : 500, transition: "all .12s",
                      }}>
                      {opt.name}
                      {opt.extra > 0 && (
                        <span style={{ fontSize: 12, marginLeft: 6, opacity: 0.75 }}>+{fmt(opt.extra)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Cantidad */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, margin: "8px 0 20px" }}>
            <span style={{ ...S.narrow, fontSize: 13, fontWeight: 700, color: C.cream, letterSpacing: 2, textTransform: "uppercase" }}>Cantidad</span>
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.surface2, borderRadius: 50, padding: "6px 16px" }}>
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtn(false)}>−</button>
              <span style={{ fontSize: 18, fontWeight: 700, minWidth: 22, textAlign: "center" }}>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} style={qtyBtn(true)}>+</button>
            </div>
          </div>
        </div>

        {/* Botón agregar */}
        <div style={{ position: "sticky", bottom: 0, background: `linear-gradient(180deg, rgba(22,20,18,0), ${C.surface} 36%)`,
          padding: "14px 20px calc(18px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.line}` }}>
          <button onClick={() => { onConfirm(product, extraTotal, selected, optionKey, qty, unit); onClose(); }}
            style={{
              width: "100%", background: C.gold, border: "none", color: "#1a1208", borderRadius: 14,
              padding: "16px 0", ...S.display, fontSize: 17, cursor: "pointer",
              boxShadow: "0 8px 22px rgba(247,201,72,0.25)",
            }}>
            Agregar — {fmt(totalPrice)}
          </button>
        </div>
      </div>
    </div>
  );
}

function qtyBtn(filled) {
  return {
    background: filled ? C.gold : C.surface, border: "none",
    width: 30, height: 30, borderRadius: "50%", color: filled ? "#1a1208" : C.cream,
    fontSize: 19, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  CustomerScreen — datos del cliente (requeridos por TUU)
// ════════════════════════════════════════════════════════════════════════════
function CustomerScreen({ total, onBack, onContinue, procesando }) {
  const [nombre, setNombre]     = useState("");
  const [apellido, setApellido] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail]       = useState("");
  const [touched, setTouched]   = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const telOk   = telefono.replace(/\D/g, "").length >= 8;
  const valido  = nombre.trim() && apellido.trim() && telOk && emailOk;

  const submit = () => {
    setTouched(true);
    if (!valido || procesando) return;
    // Normalizar teléfono a formato +56XXXXXXXXX si el cliente puso solo 9 dígitos
    let tel = telefono.replace(/\D/g, "");
    if (tel.length === 9 && tel.startsWith("9")) tel = "+56" + tel;
    else if (!telefono.trim().startsWith("+")) tel = "+56" + tel;
    else tel = telefono.trim();
    onContinue({ nombre: nombre.trim(), apellido: apellido.trim(), telefono: tel, email: email.trim() });
  };

  return (
    <div style={{ ...S.screen, paddingBottom: 120 }}>
      <div style={{ padding: "18px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div style={{ ...S.display, fontSize: 22, color: C.gold }}>Tus datos</div>
      </div>

      <div style={{ padding: "8px 20px 0", fontSize: 14, color: C.textDim }}>
        Los necesitamos para tu boleta y para avisarte cuando tu pedido esté listo.
      </div>

      <div style={{ padding: "22px 20px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Nombre" value={nombre} onChange={setNombre} placeholder="Tu nombre"
               error={touched && !nombre.trim() ? "Ingresa tu nombre" : ""} />
        <Field label="Apellido" value={apellido} onChange={setApellido} placeholder="Tu apellido"
               error={touched && !apellido.trim() ? "Ingresa tu apellido" : ""} />
        <Field label="Teléfono" value={telefono} onChange={setTelefono} placeholder="9 1234 5678"
               inputMode="tel"
               error={touched && !telOk ? "Teléfono inválido" : ""} />
        <Field label="Email" value={email} onChange={setEmail} placeholder="tucorreo@mail.com"
               inputMode="email"
               error={touched && !emailOk ? "Email inválido" : ""} />
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 520, margin: "0 auto",
        background: `linear-gradient(180deg, rgba(10,10,10,0), ${C.bg} 40%)`,
        padding: "18px 20px calc(20px + env(safe-area-inset-bottom, 0px))" }}>
        <button onClick={submit} disabled={procesando} style={{
          width: "100%", background: valido ? C.gold : C.surface2,
          border: "none", color: valido ? "#1a1208" : C.textDim, borderRadius: 14,
          padding: "17px 0", ...S.display, fontSize: 17, cursor: procesando ? "wait" : "pointer",
          boxShadow: valido ? "0 8px 22px rgba(247,201,72,0.25)" : "none",
        }}>
          {procesando ? "Conectando con TUU…" : `Pagar ${fmt(total)} con TUU`}
        </button>
        <div style={{ textAlign: "center", fontSize: 12, color: C.textDim, marginTop: 10 }}>
          Pago seguro · El Completito solo retiro en local
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, error, inputMode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ ...S.narrow, fontSize: 12, fontWeight: 700, color: C.cream, letterSpacing: 2,
        textTransform: "uppercase", marginBottom: 7 }}>{label}</div>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode}
        style={{
          width: "100%", background: C.surface, border: `1.5px solid ${error ? C.red : C.line}`,
          borderRadius: 12, padding: "14px 15px", fontSize: 16, color: C.text,
        }} />
      {error && <div style={{ fontSize: 12, color: C.red, marginTop: 5 }}>{error}</div>}
    </label>
  );
}

const backBtn = {
  width: 38, height: 38, borderRadius: "50%", background: C.surface2,
  border: `1px solid ${C.line}`, color: C.cream, fontSize: 18, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

// ════════════════════════════════════════════════════════════════════════════
//  Pantallas de resultado
// ════════════════════════════════════════════════════════════════════════════
function SuccessScreen({ numero, total, onVolver }) {
  return (
    <div style={{ ...S.screen, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100dvh", padding: "0 28px", textAlign: "center" }}>
      <div style={{ width: 92, height: 92, borderRadius: "50%", background: C.ok,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, color: "#0a0a0a", marginBottom: 26 }}>✓</div>
      <div style={{ ...S.display, fontSize: 30, color: C.gold }}>¡Pago recibido!</div>
      <div style={{ fontSize: 15, color: C.textDim, marginTop: 10, maxWidth: 320 }}>
        Tu pedido está en preparación. Muestra este número al retirar en el local.
      </div>
      <div style={{ marginTop: 30, background: C.surface, border: `2px solid ${C.gold}`, borderRadius: 18, padding: "22px 40px" }}>
        <div style={{ ...S.narrow, fontSize: 12, color: C.textDim, letterSpacing: 3, textTransform: "uppercase" }}>Pedido N°</div>
        <div style={{ ...S.display, fontSize: 64, color: C.gold, lineHeight: 1 }}>{numero != null ? numero : "—"}</div>
      </div>
      {total ? <div style={{ marginTop: 18, fontSize: 15, color: C.cream }}>Total pagado: <b>{fmt(total)}</b></div> : null}
      <button onClick={onVolver} style={{
        marginTop: 36, background: "transparent", border: `1.5px solid ${C.line}`, color: C.cream,
        borderRadius: 12, padding: "13px 30px", fontSize: 15, cursor: "pointer", ...S.narrow, fontWeight: 700, letterSpacing: 1 }}>
        Hacer otro pedido
      </button>
    </div>
  );
}

function FailScreen({ tipo, onVolver }) {
  const cancelado = tipo === "cancelado";
  return (
    <div style={{ ...S.screen, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100dvh", padding: "0 28px", textAlign: "center" }}>
      <div style={{ width: 92, height: 92, borderRadius: "50%", background: C.surface2,
        border: `2px solid ${C.red}`, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 44, color: C.red, marginBottom: 26 }}>{cancelado ? "↩" : "×"}</div>
      <div style={{ ...S.display, fontSize: 26, color: C.cream }}>
        {cancelado ? "Pago cancelado" : "Pago no procesado"}
      </div>
      <div style={{ fontSize: 15, color: C.textDim, marginTop: 10, maxWidth: 320 }}>
        {cancelado ? "No se realizó ningún cobro." : "No se realizó ningún cobro. Puedes intentar de nuevo."}
      </div>
      <button onClick={onVolver} style={{
        marginTop: 32, background: C.gold, border: "none", color: "#1a1208",
        borderRadius: 12, padding: "15px 34px", ...S.display, fontSize: 16, cursor: "pointer" }}>
        Volver al menú
      </button>
    </div>
  );
}

function WelcomeScreen({ onStart }) {
  return (
    <div style={{ ...S.screen, minHeight: "100dvh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "0 28px", textAlign: "center",
      background: `radial-gradient(120% 80% at 50% 0%, #1c160d 0%, ${C.bg} 60%)` }}>
      <div style={{ ...S.narrow, fontSize: 13, letterSpacing: 5, color: C.goldDeep, textTransform: "uppercase", marginBottom: 6 }}>
        28 años de tradición familiar
      </div>
      <div style={{ ...S.display, fontSize: 56, lineHeight: 0.92, color: C.gold }}>El<br />Completito</div>
      <div style={{ ...S.narrow, fontSize: 22, letterSpacing: 8, color: C.cream, marginTop: 8, textTransform: "uppercase" }}>Hualpén</div>
      <button onClick={onStart} style={{
        marginTop: 44, background: C.gold, border: "none", color: "#1a1208", borderRadius: 14,
        padding: "17px 46px", ...S.display, fontSize: 19, cursor: "pointer",
        boxShadow: "0 10px 30px rgba(247,201,72,0.3)" }}>
        Pedir ahora
      </button>
      <div style={{ marginTop: 22, fontSize: 13, color: C.textDim }}>Solo retiro en el local</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  App principal
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [welcome, setWelcome]   = useState(true);
  const [cat, setCat]           = useState(CATEGORIES[0]);
  const [carrito, setCarrito]   = useState([]);
  const [modal, setModal]       = useState(null);     // producto en OptionsModal
  const [verCarrito, setVerCarrito] = useState(false);
  const [pantalla, setPantalla] = useState("menu");   // menu | datos
  const [procesando, setProc]   = useState(false);
  const [resultado, setResultado] = useState(null);   // {tipo, numero, total}

  // Overrides de precio/disponibilidad (editables desde el panel, sync por Firestore)
  const [overrides, setOverrides] = useState(() => loadJSON(STORAGE_KEYS.overrides, {}));
  const [admin, setAdmin] = useState(false);   // panel abierto
  const [pinPanel, setPinPanel] = useState(false);
  const logoTaps = useRef(0);

  // ── Sincronización con Firestore (tiempo real) ─────────────────────────────
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        await firebasePull(STORAGE_KEYS);
        setOverrides(loadJSON(STORAGE_KEYS.overrides, {}));
        unsub = firebaseSubscribe(STORAGE_KEYS, () => {
          setOverrides(loadJSON(STORAGE_KEYS.overrides, {}));
        });
      } catch (e) { console.warn("Firestore no disponible:", e); }
    })();
    return () => unsub();
  }, []);

  // Cuando el panel cambia overrides, guardar local + empujar a Firestore
  const updateOverrides = (updater) => {
    setOverrides((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveJSON(STORAGE_KEYS.overrides, next);
      firebasePush(STORAGE_KEYS).catch(() => {});
      return next;
    });
  };

  // Menú efectivo: aplica precios/disponibilidad de los overrides
  const menu = useMemo(() => MENU.map((p) => {
    const ov = overrides[p.id] || {};
    return {
      ...p,
      base: ov.base != null ? ov.base : p.base,
      premium: ov.premium != null ? ov.premium : (p.premium != null ? p.premium : null),
      agotado: !!ov.agotado,
    };
  }), [overrides]);

  // Acceso al panel: 5 toques rápidos en el logo
  const tapLogo = () => {
    logoTaps.current += 1;
    if (logoTaps.current >= 5) { logoTaps.current = 0; setPinPanel(true); }
    setTimeout(() => { logoTaps.current = 0; }, 1500);
  };

  const total = carrito.reduce((s, i) => s + i.precioUnit * i.cantidad, 0);
  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);

  // ── Manejo del retorno desde TUU (?pago=completo|cancelado&ref=...) ─────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pago = params.get("pago");
    const ref  = params.get("ref");
    if (!pago) return;

    const limpiarURL = () =>
      window.history.replaceState({}, document.title, window.location.pathname);

    if (pago === "cancelado") {
      setResultado({ tipo: "cancelado" });
      setWelcome(false);
      limpiarURL();
      return;
    }

    if (pago === "completo" && ref) {
      // Consultar el estado real del pedido (el callback ya debió actualizarlo)
      setWelcome(false);
      let intentos = 0;
      const consultar = async () => {
        try {
          const r = await fetch(`${FN_CONSULTAR_PEDIDO}?ref=${encodeURIComponent(ref)}`);
          const j = await r.json();
          const res = j.result;
          if (res && res.pagoEstado === "aprobado") {
            setResultado({ tipo: "exito", numero: res.numero, total: res.total });
            setCarrito([]);
          } else if (res && res.pagoEstado === "rechazado") {
            setResultado({ tipo: "rechazado" });
          } else if (intentos < 5) {
            intentos++;
            setTimeout(consultar, 1500); // el callback puede tardar unos segundos
          } else {
            // Aún pendiente: mostramos éxito tentativo con el número si lo hay
            setResultado(res?.numero != null
              ? { tipo: "exito", numero: res.numero, total: res.total }
              : { tipo: "rechazado" });
            setCarrito([]);
          }
        } catch {
          if (intentos < 5) { intentos++; setTimeout(consultar, 1500); }
          else setResultado({ tipo: "rechazado" });
        }
      };
      consultar();
      limpiarURL();
    }
  }, []);

  // ── Carrito ─────────────────────────────────────────────────────────────
  const addProducto = (p, extraTotal, optionDetails, optionKey, qty, precioUnit) => {
    const key = `${p.id}::${optionKey}`;
    setCarrito((prev) => {
      const found = prev.find((i) => i.cartKey === key);
      if (found) return prev.map((i) => i.cartKey === key ? { ...i, cantidad: i.cantidad + qty } : i);
      return [...prev, {
        cartKey: key, id: p.id, nombre: p.nombre,
        precioUnit, optionDetails, optionKey,
        optionText: optionDetails.map((o) => o.name).join(", "),
        cantidad: qty,
      }];
    });
  };

  const quickAdd = (p) => {
    if (p.agotado) return;
    const groups = optionGroupsFor(p);
    if (groups.length) { setModal(p); return; }
    // Producto simple (bebidas): agregar directo
    const key = `${p.id}::base`;
    setCarrito((prev) => {
      const found = prev.find((i) => i.cartKey === key);
      if (found) return prev.map((i) => i.cartKey === key ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, { cartKey: key, id: p.id, nombre: p.nombre, precioUnit: p.base,
        optionDetails: [], optionKey: "base", optionText: "", cantidad: 1 }];
    });
  };

  const changeQty = (key, delta) =>
    setCarrito((prev) => prev
      .map((i) => i.cartKey === key ? { ...i, cantidad: i.cantidad + delta } : i)
      .filter((i) => i.cantidad > 0));

  const removeItem = (key) => setCarrito((prev) => prev.filter((i) => i.cartKey !== key));

  // ── Pago con TUU ────────────────────────────────────────────────────────
  const pagar = async (cliente) => {
    if (procesando) return;
    setProc(true);
    try {
      const resp = await fetch(FN_INICIAR_PAGO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            items: carrito.map((i) => ({
              nombre: i.nombre, cantidad: i.cantidad,
              precio: i.precioUnit, personalizacion: i.optionText || "",
            })),
            total, cliente,
          },
        }),
      });
      const json = await resp.json();
      const url = json?.result?.url;
      if (!url) throw new Error(json?.error || "Sin URL de pago");
      window.location.href = url; // redirige a la pasarela de TUU
    } catch (err) {
      console.error("Error iniciando pago:", err);
      setProc(false);
      alert("No se pudo conectar con el sistema de pago. Intenta de nuevo.");
    }
  };

  const reset = () => {
    setResultado(null); setCarrito([]); setVerCarrito(false);
    setPantalla("menu"); setWelcome(true); setProc(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (pinPanel && !admin)
    return <PinScreen onSuccess={() => { setPinPanel(false); setAdmin(true); }}
      onCancel={() => setPinPanel(false)} />;
  if (admin)
    return <AdminPanel onClose={() => setAdmin(false)} menu={menu}
      overrides={overrides} setOverrides={updateOverrides} />;

  if (resultado?.tipo === "exito")
    return <SuccessScreen numero={resultado.numero} total={resultado.total} onVolver={reset} />;
  if (resultado?.tipo === "rechazado" || resultado?.tipo === "cancelado")
    return <FailScreen tipo={resultado.tipo} onVolver={() => { setResultado(null); setPantalla("menu"); }} />;
  if (welcome) return <WelcomeScreen onStart={() => setWelcome(false)} />;

  if (pantalla === "datos")
    return <CustomerScreen total={total} procesando={procesando}
      onBack={() => setPantalla("menu")} onContinue={pagar} />;

  const productos = menu.filter((p) => p.cat === cat);

  return (
    <div style={{ ...S.screen, paddingBottom: totalItems > 0 ? 130 : 24 }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div onClick={tapLogo} style={{ cursor: "default" }}>
            <div style={{ ...S.display, fontSize: 24, color: C.gold, lineHeight: 0.95 }}>El Completito</div>
            <div style={{ ...S.narrow, fontSize: 11, letterSpacing: 4, color: C.textDim, textTransform: "uppercase" }}>Hualpén</div>
          </div>
          {carrito.length > 0 && (
            <button onClick={() => setCarrito([])} style={{
              background: "transparent", border: `1px solid ${C.line}`, color: C.textDim,
              borderRadius: 10, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>
              Vaciar
            </button>
          )}
        </div>
        {/* Categorías */}
        <div style={{ display: "flex", gap: 8, padding: "0 20px 14px", overflowX: "auto" }}>
          {CATEGORIES.map((c) => {
            const on = c === cat;
            return (
              <button key={c} onClick={() => setCat(c)} style={{
                background: on ? C.gold : C.surface, color: on ? "#1a1208" : C.cream,
                border: "none", borderRadius: 50, padding: "9px 20px", fontSize: 14,
                fontWeight: on ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", ...S.narrow,
                letterSpacing: 1, textTransform: "uppercase" }}>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de productos */}
      <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        {productos.map((p) => {
          const enCarrito = carrito.filter((i) => i.id === p.id).reduce((s, i) => s + i.cantidad, 0);
          return (
            <button key={p.id} onClick={() => quickAdd(p)} disabled={p.agotado} style={{
              textAlign: "left", background: enCarrito ? C.surface2 : C.surface,
              border: enCarrito ? `2px solid ${C.gold}` : `1px solid ${C.line}`,
              borderRadius: 16, padding: "16px 16px", cursor: p.agotado ? "not-allowed" : "pointer",
              position: "relative", opacity: p.agotado ? 0.45 : 1,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...S.display, fontSize: 19, color: C.text }}>{p.nombre}</span>
                  {p.agotado && (
                    <span style={{ background: C.red, color: "#fff", borderRadius: 50,
                      fontSize: 11, fontWeight: 800, padding: "2px 9px" }}>Agotado</span>
                  )}
                  {!p.agotado && enCarrito > 0 && (
                    <span style={{ background: C.gold, color: "#1a1208", borderRadius: 50,
                      fontSize: 12, fontWeight: 800, padding: "2px 9px" }}>×{enCarrito}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>{p.ingredientes}</div>
                <div style={{ marginTop: 8, fontSize: 14, color: C.gold, ...S.narrow, fontWeight: 700 }}>
                  {p.premium != null
                    ? <>Desde {fmt(p.base)} <span style={{ color: C.textDim, fontWeight: 500 }}>· premium {fmt(p.premium)}</span></>
                    : fmt(p.base)}
                </div>
              </div>
              {!p.agotado && (
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.gold,
                  display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1208",
                  fontSize: 24, flexShrink: 0, ...S.display }}>+</div>
              )}
            </button>
          );
        })}
        <div style={{ textAlign: "center", fontSize: 12, color: C.textDim, padding: "14px 0 0" }}>
          Agrega choclo o tocino por $1.200 · Solo retiro en el local
        </div>
      </div>

      {/* Barra inferior carrito */}
      {totalItems > 0 && !verCarrito && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 520, margin: "0 auto",
          padding: "12px 20px calc(14px + env(safe-area-inset-bottom, 0px))",
          background: `linear-gradient(180deg, rgba(10,10,10,0), ${C.bg} 40%)` }}>
          <button onClick={() => setVerCarrito(true)} style={{
            width: "100%", background: C.gold, border: "none", color: "#1a1208", borderRadius: 14,
            padding: "15px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", boxShadow: "0 8px 24px rgba(247,201,72,0.28)" }}>
            <span style={{ ...S.display, fontSize: 16 }}>Ver pedido ({totalItems})</span>
            <span style={{ ...S.display, fontSize: 18 }}>{fmt(total)}</span>
          </button>
        </div>
      )}

      {/* Hoja del carrito */}
      {verCarrito && (
        <CartSheet
          carrito={carrito} total={total}
          onClose={() => setVerCarrito(false)}
          onChangeQty={changeQty} onRemove={removeItem}
          onCheckout={() => { setVerCarrito(false); setPantalla("datos"); }}
        />
      )}

      {modal && <OptionsModal product={modal} onClose={() => setModal(null)} onConfirm={addProducto} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  CartSheet — resumen del pedido
// ════════════════════════════════════════════════════════════════════════════
function CartSheet({ carrito, total, onClose, onChangeQty, onRemove, onCheckout }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 4000,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: "22px 22px 0 0", width: "100%", maxWidth: 520,
        maxHeight: "88dvh", overflowY: "auto", borderTop: `3px solid ${C.gold}`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div style={{ padding: "20px 20px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...S.display, fontSize: 24, color: C.gold }}>Tu pedido</div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: "50%", background: C.surface2,
            border: `1px solid ${C.line}`, color: C.cream, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ padding: "8px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {carrito.map((item) => (
            <div key={item.cartKey} style={{ background: C.surface2, borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...S.display, fontSize: 16, color: C.text }}>{item.nombre}</div>
                {item.optionText && <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>{item.optionText}</div>}
                <div style={{ fontSize: 13, color: C.gold, ...S.narrow, fontWeight: 700, marginTop: 4 }}>
                  {fmt(item.precioUnit * item.cantidad)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 50, padding: "5px 10px" }}>
                <button onClick={() => onChangeQty(item.cartKey, -1)} style={qtyBtn(false)}>−</button>
                <span style={{ fontSize: 16, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{item.cantidad}</span>
                <button onClick={() => onChangeQty(item.cartKey, +1)} style={qtyBtn(true)}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "18px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...S.narrow, fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: C.cream }}>Total</span>
          <span style={{ ...S.display, fontSize: 26, color: C.gold }}>{fmt(total)}</span>
        </div>

        <div style={{ position: "sticky", bottom: 0, background: `linear-gradient(180deg, rgba(22,20,18,0), ${C.surface} 36%)`,
          padding: "14px 20px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
          <button onClick={onCheckout} style={{
            width: "100%", background: C.gold, border: "none", color: "#1a1208", borderRadius: 14,
            padding: "16px 0", ...S.display, fontSize: 17, cursor: "pointer",
            boxShadow: "0 8px 22px rgba(247,201,72,0.25)" }}>
            Continuar con mis datos
          </button>
        </div>
      </div>
    </div>
  );
}
