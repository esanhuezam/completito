// functions/index.js — Firebase Functions para TUU Pago Online
// El Completito Hualpén
//
// Flujo:
//  1) El cliente arma su pedido y presiona "Pagar".
//  2) iniciarPago: crea el pedido en Firestore + genera la firma HMAC-SHA256
//     + hace POST a TUU. TUU devuelve la URL de pago. Redirigimos al cliente.
//  3) El cliente paga en la pasarela de TUU.
//  4) callbackTuu (server-to-server): TUU notifica el resultado real. Esta es
//     la FUENTE DE VERDAD. Verificamos la firma y actualizamos el pedido.
//  5) TUU redirige al cliente a x_url_complete -> volvemos a la app con el
//     número de orden.

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1' });

// ── Credenciales TUU como secrets / variables de entorno ─────────────────────
// Definir con:  firebase functions:secrets:set TUU_ACCOUNT_ID
//               firebase functions:secrets:set TUU_SECRET_KEY
// Mientras pruebas, puedes usar las credenciales de integración (ver INSTRUCCIONES.md).
const TUU_ACCOUNT_ID = defineSecret('TUU_ACCOUNT_ID');
const TUU_SECRET_KEY = defineSecret('TUU_SECRET_KEY');

// ── Configuración de ambiente ────────────────────────────────────────────────
const IS_PRODUCTION = false; // ← cambiar a true para producción

const TUU_API_URL = IS_PRODUCTION
  ? 'https://core.payment.haulmer.com/api/v1/payment'
  : 'https://frontend-api.payment.haulmer.dev/v1/payment';

// URL pública de la app (donde vuelve el cliente tras pagar).
const APP_URL = IS_PRODUCTION
  ? 'https://esanhuezam.github.io/completito'
  : 'https://esanhuezam.github.io/completito'; // ajustar si usas otro dominio/ngrok en pruebas

const SHOP_NAME = 'El Completito Hualpén';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: genera la firma HMAC-SHA256 según la especificación de TUU/Haulmer.
// (Verificado contra la implementación de referencia oficial de Pago Fácil/Haulmer,
//  que es la misma infraestructura que usa TUU Pago Online.)
//  1. Tomar todos los campos que empiezan con "x_" (excluyendo x_signature)
//  2. Ordenar alfabéticamente por par [clave, valor]
//  3. Concatenar clave+valor sin separadores
//  4. HMAC-SHA256 en hexadecimal minúsculas, encoding UTF-8
// ─────────────────────────────────────────────────────────────────────────────
function generarFirma(datos, llaveSecreta) {
  const entradas = Object.entries(datos)
    .filter(([k]) => k.startsWith('x_') && k !== 'x_signature')
    .sort(); // ordena por [clave, valor] como la referencia oficial

  let cadena = '';
  for (const [clave, valor] of entradas) {
    cadena += clave + (valor == null ? '' : String(valor));
  }

  return crypto
    .createHmac('sha256', llaveSecreta)
    .update(cadena, 'utf8')
    .digest('hex');
}

// ── Helper: número correlativo del día ───────────────────────────────────────
async function getNextOrderNumber() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const snap = await db.collection('pedidos')
    .where('creadoEn', '>=', hoy)
    .orderBy('creadoEn', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return 1;
  return (snap.docs[0].data().numero || 0) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 1: iniciarPago  (onRequest para poder llamarla con fetch desde la app)
// ─────────────────────────────────────────────────────────────────────────────
exports.iniciarPago = onRequest(
  { cors: true, secrets: [TUU_ACCOUNT_ID, TUU_SECRET_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
      const body = req.body?.data || req.body || {};
      const { items, total, cliente } = body;

      // Validaciones
      if (!Array.isArray(items) || items.length === 0 || !total || total <= 0) {
        return res.status(400).json({ error: 'Datos del pedido inválidos' });
      }
      if (!cliente?.email || !cliente?.nombre || !cliente?.apellido || !cliente?.telefono) {
        return res.status(400).json({ error: 'Faltan datos del cliente' });
      }

      const accountId = TUU_ACCOUNT_ID.value();
      const secretKey = TUU_SECRET_KEY.value();

      const numero = await getNextOrderNumber();

      // Crear el pedido en Firestore (estado inicial)
      const orderRef = await db.collection('pedidos').add({
        items,
        total,
        numero,
        cliente: {
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          email: cliente.email,
          telefono: cliente.telefono,
        },
        canal: 'web',
        estado: 'iniciando_pago',
        pago: { metodo: 'tuu_online', estado: 'pendiente' },
        creadoEn: FieldValue.serverTimestamp(),
      });

      // Referencia única para TUU (idempotencia)
      const xReference = `CH-${numero}-${orderRef.id.substring(0, 8).toUpperCase()}`;

      const descripcion = items
        .map((i) => `${i.cantidad}x ${i.nombre}`)
        .join(', ')
        .substring(0, 120);

      // Campos x_ requeridos por TUU
      const datos = {
        x_account_id: accountId,
        x_amount: total,
        x_currency: 'CLP',
        x_customer_email: cliente.email,
        x_customer_first_name: cliente.nombre,
        x_customer_last_name: cliente.apellido,
        x_customer_phone: cliente.telefono,
        x_description: descripcion || `Pedido #${numero}`,
        x_reference: xReference,
        x_shop_name: SHOP_NAME,
        x_url_callback: `https://callbacktuu-dj7at3pwga-uc.a.run.app`,
        x_url_cancel: `${APP_URL}/?pago=cancelado&ref=${xReference}`,
        x_url_complete: `${APP_URL}/?pago=completo&ref=${xReference}`,
      };

      // Firma (siempre en backend)
      datos.x_signature = generarFirma(datos, secretKey);

      // Guardar la referencia para localizar el pedido en el callback
      await orderRef.update({ 'pago.xReference': xReference });

      // POST a TUU
      const tuuResp = await fetch(TUU_API_URL, {
        method: 'POST',
        headers: {
          'X-REDIRECT': 'false',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(datos),
      });

      const tuuText = await tuuResp.text();
      if (!tuuResp.ok) {
        console.error('Error TUU:', tuuResp.status, tuuText);
        await orderRef.update({ estado: 'error_tuu' });
        return res.status(502).json({ error: 'Error al conectar con TUU' });
      }

      // TUU puede responder de dos formas:
      //  a) un JSON con la URL en algún campo (url / payment_url / data.url ...)
      //  b) la URL directamente como texto plano
      let paymentUrl = null;
      const trimmed = (tuuText || '').trim();

      try {
        const tuuJson = JSON.parse(trimmed);
        paymentUrl =
          tuuJson.url ||
          tuuJson.payment_url ||
          tuuJson.redirect_url ||
          tuuJson.paymentUrl ||
          tuuJson.data?.url ||
          (typeof tuuJson === 'string' ? tuuJson : null);
      } catch {
        // No era JSON. Si el texto es una URL, usarla directo.
        if (/^https?:\/\//i.test(trimmed)) {
          paymentUrl = trimmed.replace(/^"|"$/g, ''); // por si viene entre comillas
        }
      }

      if (!paymentUrl) {
        console.error('Respuesta TUU sin URL de pago:', tuuText);
        await orderRef.update({ estado: 'error_tuu' });
        return res.status(502).json({ error: 'TUU no devolvió URL de pago' });
      }

      await orderRef.update({ estado: 'esperando_pago' });

      return res.json({
        result: {
          url: paymentUrl,
          orderId: orderRef.id,
          reference: xReference,
        },
      });
    } catch (err) {
      console.error('Error iniciarPago:', err);
      return res.status(500).json({ error: 'Error interno al iniciar el pago' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 2: callbackTuu  (server-to-server — FUENTE DE VERDAD)
//  TUU envía POST application/x-www-form-urlencoded con los parámetros x_*.
//  Verificamos la firma y actualizamos el pedido de forma idempotente.
// ─────────────────────────────────────────────────────────────────────────────
exports.callbackTuu = onRequest(
  { cors: false, secrets: [TUU_SECRET_KEY] },
  async (req, res) => {
    try {
      const params = { ...(req.body || {}), ...(req.query || {}) };
      const xReference = params.x_reference;
      const xResult = params.x_result; // completed | failed | pending
      const xSignature = params.x_signature;

      if (!xReference) {
        return res.status(400).send('Falta x_reference');
      }

      // Verificar firma
      const secretKey = TUU_SECRET_KEY.value();
      const firmaEsperada = generarFirma(params, secretKey);
      const firmaValida = xSignature && firmaEsperada === xSignature;

      // Localizar el pedido por la referencia
      const snap = await db.collection('pedidos')
        .where('pago.xReference', '==', xReference)
        .limit(1)
        .get();

      if (snap.empty) {
        console.error('callbackTuu: pedido no encontrado', xReference);
        return res.status(200).send('OK'); // 200 para que TUU no reintente infinito
      }

      const docRef = snap.docs[0].ref;
      const pedido = snap.docs[0].data();

      // Idempotencia: si ya está resuelto, no reprocesar
      if (pedido.pago?.estado === 'aprobado' || pedido.pago?.estado === 'rechazado') {
        return res.status(200).send('OK');
      }

      if (!firmaValida) {
        console.error('callbackTuu: firma inválida para', xReference);
        await docRef.update({
          estado: 'error_firma',
          'pago.firmaValida': false,
          'pago.callbackEn': FieldValue.serverTimestamp(),
        });
        return res.status(200).send('OK');
      }

      const aprobado = xResult === 'completed';
      const estadoPedido = aprobado ? 'pendiente' : 'pago_rechazado';

      await docRef.update({
        estado: estadoPedido,
        'pago.estado': aprobado ? 'aprobado' : 'rechazado',
        'pago.resultadoTuu': xResult || null,
        'pago.mensajeTuu': params.x_message || null,
        'pago.firmaValida': true,
        'pago.callbackEn': FieldValue.serverTimestamp(),
      });

      return res.status(200).send('OK');
    } catch (err) {
      console.error('Error callbackTuu:', err);
      // Responder 200 igual: TUU reintenta ante 5xx, evitamos loops si el error es nuestro
      return res.status(200).send('OK');
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 4: listarPedidos  (el panel admin lista los pedidos del día)
//  Protegida con un PIN simple enviado como query (?pin=...). Para algo más
//  robusto conviene Firebase Auth, pero esto evita exponer la colección.
// ─────────────────────────────────────────────────────────────────────────────
const ADMIN_PIN = defineSecret('ADMIN_PIN');

exports.listarPedidos = onRequest(
  { cors: true, secrets: [ADMIN_PIN] },
  async (req, res) => {
    try {
      const pin = req.query.pin || req.body?.pin;
      if (!pin || pin !== ADMIN_PIN.value()) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const snap = await db.collection('pedidos')
        .where('creadoEn', '>=', hoy)
        .orderBy('creadoEn', 'desc')
        .limit(100)
        .get();

      const pedidos = snap.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          numero: p.numero,
          estado: p.estado,
          pagoEstado: p.pago?.estado,
          total: p.total,
          items: p.items || [],
          cliente: p.cliente || {},
          creadoEn: p.creadoEn?.toMillis ? p.creadoEn.toMillis() : null,
        };
      });

      return res.json({ result: { pedidos } });
    } catch (err) {
      console.error('Error listarPedidos:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 3: consultarPedido  (la app consulta el estado tras la redirección)
// ─────────────────────────────────────────────────────────────────────────────
exports.consultarPedido = onRequest({ cors: true }, async (req, res) => {
  try {
    const ref = req.query.ref || req.body?.ref;
    if (!ref) return res.status(400).json({ error: 'Falta ref' });

    const snap = await db.collection('pedidos')
      .where('pago.xReference', '==', ref)
      .limit(1)
      .get();

    if (snap.empty) return res.status(404).json({ error: 'Pedido no encontrado' });

    const p = snap.docs[0].data();
    return res.json({
      result: {
        numero: p.numero,
        estado: p.estado,
        pagoEstado: p.pago?.estado,
        total: p.total,
      },
    });
  } catch (err) {
    console.error('Error consultarPedido:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});
