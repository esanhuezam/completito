# GUÍA DESDE CERO — El Completito Hualpén

Esta guía te lleva de un proyecto vacío a la app funcionando, sin cruzar nada con tu
proyecto anterior (Nomade). Sigue los pasos **en orden**. Cada bloque de comandos es
para PowerShell en Windows.

---

## ⚠️ Lo más importante: mantener todo SEPARADO de Nomade

Nada se cruza mientras uses identificadores nuevos. Ya dejé el código apuntando a los
nuevos, así que tú solo tienes que:

1. Crear un **proyecto Firebase nuevo** (no reutilizar `nomade-kiosk`).
2. Crear un **repo GitHub nuevo** (`completito`, no `autoatencicon`).
3. Verificar SIEMPRE que el proyecto activo sea el correcto antes de desplegar
   (con `firebase use`).

| Recurso | Nomade (NO tocar) | El Completito (nuevo) |
|---|---|---|
| Proyecto Firebase | `nomade-kiosk` | `completito-hualpen` |
| Doc Firestore | `kiosk/nomade-kafe` | `tienda/completito-hualpen` |
| Repo GitHub | `autoatencicon` | `completito` |
| Carpeta local | …\Nomade\… | …\Completito\ (carpeta nueva) |

> Como cada proyecto Firebase es una base de datos aparte, aunque ambos tengan una
> colección llamada `pedidos`, viven en proyectos distintos y JAMÁS se mezclan.

---

## PARTE A — Descomprimir el proyecto

1. Descomprime `Completito_Hualpen.7z` en una carpeta NUEVA, por ejemplo:
   `C:\Users\Erik\Desktop\Completito\`
   (No la pongas dentro de la carpeta de Nomade.)

2. Abre PowerShell en esa carpeta:
   ```powershell
   cd C:\Users\Erik\Desktop\Completito
   ```

---

## PARTE B — Crear el proyecto en Firebase

### B1. Crear el proyecto
1. Entra a https://console.firebase.google.com (con tu cuenta de Google de siempre).
2. Clic en **Agregar proyecto / Add project**.
3. Nombre: `completito-hualpen` (Firebase puede agregarle un sufijo, ej:
   `completito-hualpen-1a2b3`. Anota el **ID real** que te asigne, lo necesitarás).
4. Puedes **desactivar Google Analytics** (no lo necesitas). Crear proyecto.

### B2. Activar Firestore
1. En el menú izquierdo: **Build → Firestore Database**.
2. **Crear base de datos** → modo **Producción** → ubicación `southamerica-west1`
   (Santiago) o `us-central1`. Confirmar.

### B3. Activar el plan Blaze (obligatorio para las Functions)
1. Abajo a la izquierda, en el ícono de tu plan, clic en **Actualizar / Upgrade**.
2. Elige el plan **Blaze (pago por uso)**. Necesita una tarjeta, pero para este
   volumen el costo es prácticamente $0; igual puedes ponerle un presupuesto de alerta.
   - Las Functions hacen un `fetch` a TUU (servicio externo), y eso solo está
     permitido en Blaze. Por eso es obligatorio.

### B4. Registrar la app web y copiar credenciales
1. En **Project Overview** (engranaje → Configuración del proyecto), baja a **Tus apps**.
2. Clic en el ícono **</>** (Web). Apodo: `completito-web`. Registrar app.
3. Te mostrará un objeto `firebaseConfig` con `apiKey`, `projectId`, etc.
4. Abre `src/firebase.js` y reemplaza los `REEMPLAZAR_*` con esos valores reales.
   - **Importante:** el `projectId` debe ser el ID real que te asignó Firebase en B1.

### B5. Instalar Firebase CLI (si no la tienes)
```powershell
npm install -g firebase-tools
firebase --version
```

### B6. Iniciar sesión y elegir el proyecto correcto
```powershell
firebase login
firebase use --add
```
- `firebase use --add` te lista tus proyectos: **selecciona el de completito**
  (NO nomade-kiosk). Ponle alias `default`.
- Verifica siempre con:
  ```powershell
  firebase use
  ```
  Debe responder con el proyecto de completito. Si dice nomade-kiosk, NO sigas:
  ejecuta `firebase use completito-hualpen` (o el ID real).

---

## PARTE C — Instalar dependencias

```powershell
cd C:\Users\Erik\Desktop\Completito
npm install
cd functions
npm install
cd ..
```

---

## PARTE D — Credenciales de TUU (modo prueba primero)

Por ahora usa las credenciales de **integración** de TUU (no cobran de verdad):

```powershell
firebase functions:secrets:set TUU_ACCOUNT_ID
# cuando pregunte, pega:  62224230

firebase functions:secrets:set TUU_SECRET_KEY
# pega:  yAk0dXTJLQzkeEWODsQWVpPX0bn7ND50qwoQrXgqqNiUyEpgxIPxPtoCgKeLNeh1upTw72JZx5O9x5IaAtPIGUAVcMNcsUSg3M0M8tgWdUb4F8qkS8I7rHpOUmZqzvfS

firebase functions:secrets:set ADMIN_PIN
# pega un PIN para ver pedidos, ej:  4321
```

En `functions/index.js` deja `IS_PRODUCTION = false` (ya viene así). Esto usa el
endpoint de pruebas de TUU.

---

## PARTE E — Primer deploy de Functions y ajuste de URLs

```powershell
firebase deploy --only functions
```

Al terminar imprime las URLs de cada función, algo como:
```
Function URL (iniciarPago): https://iniciarpago-XXXXX-uc.a.run.app
Function URL (callbackTuu): https://callbacktuu-XXXXX-uc.a.run.app
Function URL (consultarPedido): https://consultarpedido-XXXXX-uc.a.run.app
Function URL (listarPedidos): https://listarpedidos-XXXXX-uc.a.run.app
```

Copia esas URLs reales a:

1. `src/App.jsx` (arriba del todo):
   - `FN_INICIAR_PAGO` → URL de iniciarPago
   - `FN_CONSULTAR_PEDIDO` → URL de consultarPedido
2. `src/AdminPanel.jsx`:
   - `FN_LISTAR_PEDIDOS` → URL de listarPedidos
3. `functions/index.js`, dentro de `iniciarPago`, el campo `x_url_callback`:
   - reemplaza por la URL real de **callbackTuu**.

Vuelve a desplegar las functions para que tome el callback correcto:
```powershell
firebase deploy --only functions
```

### Publicar las reglas de Firestore
```powershell
firebase deploy --only firestore:rules
```

---

## PARTE F — Crear el repositorio en GitHub

### F1. Crear el repo vacío
1. Entra a https://github.com/new (con tu cuenta `esanhuezam`).
2. Repository name: **completito**
3. Déjalo **Público** (necesario para GitHub Pages gratis).
4. NO marques "Add a README" (lo subimos nosotros). Clic en **Create repository**.

### F2. Subir el código (rama main)
Desde `C:\Users\Erik\Desktop\Completito`:
```powershell
git init
git add -A
git commit -m "Proyecto inicial El Completito Hualpén"
git branch -M main
git remote add origin https://github.com/esanhuezam/completito.git
git push -u origin main
```

> Si te pide login, usa tu usuario y un **token** de GitHub (no la contraseña normal).

---

## PARTE G — Desplegar la app a GitHub Pages

`vite.config.js` ya usa `base: '/completito/'`, que corresponde a
`https://esanhuezam.github.io/completito`.

### G1. Build + deploy de la rama gh-pages
Aquí aplica el truco que ya conoces (borrar `dist\.git` para que no se suba como
submódulo):

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

(Alternativa más simple: `npm run deploy`, que ejecuta `gh-pages -d dist`.)

### G2. Activar Pages
1. En GitHub: repo `completito` → **Settings → Pages**.
2. En "Build and deployment", Source: **Deploy from a branch**.
3. Branch: **gh-pages** / carpeta **/(root)**. Guardar.
4. Espera 1-2 minutos. Tu app quedará en:
   **https://esanhuezam.github.io/completito**

### G3. Ajustar APP_URL en las Functions
En `functions/index.js`, confirma que `APP_URL` apunte a la URL pública:
```js
const APP_URL = 'https://esanhuezam.github.io/completito';
```
Si lo cambiaste, vuelve a `firebase deploy --only functions`.

---

## PARTE H — Probar el flujo completo

1. Abre **https://esanhuezam.github.io/completito** en el celular.
2. Arma un pedido, toca "Ver pedido" → "Continuar con mis datos".
3. Llena nombre, apellido, teléfono y email → "Pagar con TUU".
4. En la pasarela usa una **tarjeta de prueba**:
   - VISA aprobada: `4051 8856 0044 6623`, CVV `123`, exp. `12/28`.
5. Tras pagar, vuelves a la app y deberías ver el **número de pedido**.
6. Entra al panel (5 toques en el logo, PIN `246810`) → pestaña **Pedidos del día**
   (PIN `4321` o el que pusiste) y verifica que aparezca la orden.

---

## PARTE I — Pasar a PRODUCCIÓN (cuando todo funcione)

1. En `functions/index.js`: `IS_PRODUCTION = true`.
2. Vuelve a setear los secrets con las credenciales **reales** de TUU.
   - Primero las tuyas (tienes contrato con TUU).
   - Cuando corresponda, las de tu cliente El Completito (mismo comando, otros valores):
     ```powershell
     firebase functions:secrets:set TUU_ACCOUNT_ID
     firebase functions:secrets:set TUU_SECRET_KEY
     ```
3. `firebase deploy --only functions`
4. Rebuild + redeploy de la app (Parte G1).

---

## Resumen de PINs y credenciales

| Qué | Dónde se cambia | Valor por defecto |
|---|---|---|
| PIN para abrir el panel | `src/AdminPanel.jsx` → `ADMIN_PIN` | `246810` |
| PIN para ver pedidos | secret `ADMIN_PIN` en Functions | el que elijas (ej. 4321) |
| Account ID TUU | secret `TUU_ACCOUNT_ID` | integración: 62224230 |
| Secret Key TUU | secret `TUU_SECRET_KEY` | integración: (la larga de arriba) |

## Checklist anti-cruce con Nomade

- [ ] `firebase use` muestra el proyecto de **completito** (no nomade-kiosk)
- [ ] `src/firebase.js` tiene el `projectId` de completito
- [ ] El repo es `github.com/esanhuezam/completito`
- [ ] La carpeta local es nueva (no dentro de Nomade)
- [ ] `vite.config.js` usa `base: '/completito/'`
