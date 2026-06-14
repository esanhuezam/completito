# El Completito Hualpén — Pedido online con TUU Pago Online

App de pedidos desde el celular con pago online vía **TUU** (pasarela de Haulmer).
Basada en la arquitectura de KIOSK·IQ (React + Vite + Firebase + Firebase Functions),
adaptada a compra desde el móvil y captura de datos del cliente.

## Estructura

```
completito/
├── src/
│   ├── App.jsx          ← app del cliente (menú, carrito, datos, resultado)
│   ├── AdminPanel.jsx    ← panel: precios, disponibilidad, pedidos del día
│   ├── firebase.js      ← config Firestore (⚠️ reemplazar credenciales)
│   └── main.jsx
├── functions/
│   ├── index.js         ← TUU: iniciarPago, callbackTuu, consultarPedido, listarPedidos
│   └── package.json
├── firebase.json
├── firestore.rules
├── vite.config.js
└── package.json
```

## Panel de administración

- Acceso: en la pantalla del menú, toca **5 veces seguidas** el logo "El Completito".
- PIN del panel (definido en `src/AdminPanel.jsx`, constante `ADMIN_PIN`): `246810`.
- Pestaña **Productos**: editar precio base, precio premium y marcar agotado.
  Los cambios se guardan en Firestore y se reflejan al instante en la app del cliente.
- Pestaña **Pedidos del día**: pide un PIN aparte (secret `ADMIN_PIN` en Functions)
  y lista las órdenes vía la función `listarPedidos`.

## Diferencias clave vs. el proyecto anterior (Nomade / Webpay)

| | Nomade (tótem) | El Completito (móvil) |
|---|---|---|
| Pasarela | Webpay Plus (transbank-sdk) | TUU Pago Online (API REST + firma HMAC) |
| Datos cliente | No pedía | Nombre, apellido, teléfono, email (obligatorio TUU) |
| Canal | `kiosk` | `web` |
| Firma | la maneja el SDK | HMAC-SHA256 propia (en `functions/index.js`) |

---

## PASO 1 — Crear proyecto Firebase

1. Crear proyecto en https://console.firebase.google.com (ej: `completito-hualpen`).
2. Activar **Firestore Database** (modo producción).
3. Activar el plan **Blaze** (las Functions con `fetch` externo lo requieren).
4. Crear una app web y copiar la config a `src/firebase.js` (reemplazar los `REEMPLAZAR_*`).

## PASO 2 — Instalar dependencias

```powershell
cd C:\ruta\completito
npm install
cd functions
npm install
cd ..
```

## PASO 3 — Configurar credenciales TUU (variables de entorno / secrets)

Mientras pruebas puedes usar las **credenciales de integración** de TUU:

- Account ID: `62224230`
- Secret Key: `yAk0dXTJLQzkeEWODsQWVpPX0bn7ND50qwoQrXgqqNiUyEpgxIPxPtoCgKeLNeh1upTw72JZx5O9x5IaAtPIGUAVcMNcsUSg3M0M8tgWdUb4F8qkS8I7rHpOUmZqzvfS`

Y en `functions/index.js` deja `IS_PRODUCTION = false` (usa el endpoint de integración).

Define los secrets:

```powershell
firebase login
firebase use completito-hualpen
firebase functions:secrets:set TUU_ACCOUNT_ID   # pega el account id
firebase functions:secrets:set TUU_SECRET_KEY   # pega el secret key
firebase functions:secrets:set ADMIN_PIN        # PIN para ver pedidos (ej: 4321)
```

Cuando pases a producción: cambia `IS_PRODUCTION = true`, y vuelve a setear los secrets
con las credenciales reales (primero las tuyas de TUU, luego las de tu cliente El Completito).

## PASO 4 — Primer deploy de Functions y ajustar URLs

```powershell
firebase deploy --only functions
```

El deploy imprime las URLs reales de cada función. Cópialas a:

- `src/App.jsx`  → `FN_INICIAR_PAGO` y `FN_CONSULTAR_PEDIDO`
- `src/AdminPanel.jsx` → `FN_LISTAR_PEDIDOS`
- `functions/index.js` → dentro de `iniciarPago`, el campo `x_url_callback`
  debe apuntar a la URL real de `callbackTuu`.

Vuelve a hacer `firebase deploy --only functions` tras ajustar el callback.

> La URL de `x_url_callback` debe ser pública y HTTPS. TUU la llama server-to-server;
> es la **fuente de verdad** del pago (no confíes solo en la redirección del navegador).

## PASO 5 — Probar con tarjetas de integración TUU

| Tarjeta | Número | CVV | Resultado |
|---|---|---|---|
| VISA | 4051 8856 0044 6623 | 123 | Aprobada |
| AMEX | 3700 0000 0002 032 | 1234 | Aprobada |
| MASTERCARD | 5186 0595 5959 0568 | 123 | Rechazada |

Expiración: cualquiera futura (ej. 12/28).

Flujo esperado: armar pedido → datos del cliente → "Pagar con TUU" → pasarela →
pago → TUU llama a `callbackTuu` (actualiza Firestore) → vuelve a la app con `?pago=completo`
→ la app consulta `consultarPedido` y muestra el número de orden.

## PASO 6 — Deploy de la app (GitHub Pages)

`vite.config.js` usa `base: '/completito/'`. Para GitHub Pages, recuerda el proceso que
ya tienes resuelto (borrar `dist/.git` antes de desplegar):

```powershell
npm run build
cd dist
Remove-Item -Recurse -Force .git -ErrorAction SilentlyContinue
git init
git checkout -b gh-pages
git add -A
git commit -m "deploy"
git remote add origin https://github.com/esanhuezam/completito.git
git push -f origin gh-pages
cd ..
```

(O usa `npm run deploy` que ya invoca `gh-pages -d dist`.)

Ajusta `APP_URL` en `functions/index.js` para que apunte a la URL pública real
(ej. `https://esanhuezam.github.io/completito`).

---

## Flujo de pago (resumen técnico)

1. Cliente arma pedido y entrega sus datos.
2. `iniciarPago`: crea el pedido en Firestore, genera la firma HMAC-SHA256 y hace
   POST a TUU. TUU responde con la URL de pago.
3. La app redirige al cliente a esa URL.
4. El cliente paga en la pasarela de TUU.
5. `callbackTuu` (server-to-server): TUU notifica el resultado. Se verifica la firma
   y se actualiza el pedido (idempotente).
6. TUU redirige al cliente a `x_url_complete` → la app consulta el estado y muestra
   el número de orden.

## Notas

- La firma SIEMPRE se genera en el backend (Functions), nunca en el navegador.
- Los pedidos viven en la colección `pedidos`; el catálogo en `tienda/completito-hualpen`.
- Solo retiro en local: no se piden datos de dirección/despacho.
