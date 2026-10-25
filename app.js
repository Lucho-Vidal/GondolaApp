/**
 * ChangoCheck — Lógica de Aplicación
 * ES Modules nativo sin bundlers
 * T-01 / T-05: Cliente Supabase conectado a producción
 * T-03: Dashboard de Inicio con KPIs y Segmented Control
 * T-04: Módulo de Cámara y Escaneo (html5-qrcode)
 * T-05: Normalización, Autocompletado y Bottom Sheet Modal
 * T-06: Sincronización Realtime, Búsqueda y Comparador de Precios
 * Gestión de Comercios: Tabla, Select dinámico y Modal de edición
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ==========================================================================
   Configuración de Supabase
   ========================================================================== */
export const SUPABASE_URL = 'https://upxateqtkrhllkcalzuu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_5xz9E8RDmnOcYknNS1VCow_ckoD76_-';

export let supabase = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.warn('Error inicializando Supabase:', e);
}

/* ==========================================================================
   Gestión de Autenticación (Google, Facebook, Email) y Propiedad
   ========================================================================== */
export let usuarioActual = null;
const LOCAL_STORAGE_MY_PRICES = 'changocheck_my_prices_ids';

let misPreciosLocales = new Set();
try {
  const guardados = JSON.parse(localStorage.getItem(LOCAL_STORAGE_MY_PRICES) || '[]');
  misPreciosLocales = new Set(guardados.map(String));
} catch (e) {}

export function registrarIdComoPropio(id) {
  if (!id) return;
  misPreciosLocales.add(String(id));
  try {
    localStorage.setItem(LOCAL_STORAGE_MY_PRICES, JSON.stringify([...misPreciosLocales]));
  } catch (e) {}
}

export function removerIdDePropios(id) {
  if (!id) return;
  misPreciosLocales.delete(String(id));
  try {
    localStorage.setItem(LOCAL_STORAGE_MY_PRICES, JSON.stringify([...misPreciosLocales]));
  } catch (e) {}
}

/**
 * Inicializa y escucha la sesión del usuario con Supabase Auth.
 */
export async function inicializarSesion() {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    usuarioActual = session?.user || null;
    actualizarUIUsuario();

    // Escuchar cambios de sesión (cuando el usuario regresa del redirect de Google o Facebook)
    supabase.auth.onAuthStateChange((_event, session) => {
      usuarioActual = session?.user || null;
      actualizarUIUsuario();
      renderizarDashboard();
    });

    return usuarioActual;
  } catch (err) {
    console.warn('Error obteniendo sesión de Supabase:', err);
    return null;
  }
}

export function abrirModalAuth() {
  modalAuthBackdrop?.classList.remove('hidden');
}

export function cerrarModalAuth() {
  modalAuthBackdrop?.classList.add('hidden');
}

export function actualizarUIUsuario() {
  if (usuarioActual) {
    btnLoginOpen?.classList.add('hidden');
    userPill?.classList.remove('hidden');

    const meta = usuarioActual.user_metadata || {};
    const nombre = meta.full_name || meta.name || usuarioActual.email?.split('@')[0] || 'Mi Perfil';
    if (userNameLabel) userNameLabel.textContent = nombre;

    const avatarUrl = meta.avatar_url || meta.picture;
    if (userAvatarBox) {
      if (avatarUrl) {
        userAvatarBox.innerHTML = `<img src="${avatarUrl}" alt="${escapeHTML(nombre)}" referrerpolicy="no-referrer">`;
      } else {
        userAvatarBox.innerHTML = `<span>${escapeHTML(nombre.charAt(0).toUpperCase())}</span>`;
      }
    }
  } else {
    btnLoginOpen?.classList.remove('hidden');
    userPill?.classList.add('hidden');
  }
}

export async function iniciarSesionOAuth(provider) {
  if (!supabase) {
    mostrarToast('Supabase no está conectado.', 'error');
    return;
  }
  try {
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl
      }
    });
    if (error) throw error;
  } catch (err) {
    console.error(`Error de autenticación con ${provider}:`, err);
    mostrarToast(`Error al iniciar con ${provider}: ${err.message}`, 'error');
  }
}

export async function iniciarSesionEmail(e) {
  e?.preventDefault();
  const email = inputAuthEmail?.value.trim();
  if (!email) {
    mostrarToast('Por favor ingresá un correo válido.', 'error');
    return;
  }

  if (!supabase) {
    mostrarToast('Supabase no está conectado.', 'error');
    return;
  }

  try {
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl
      }
    });

    if (error) throw error;
    cerrarModalAuth();
    if (inputAuthEmail) inputAuthEmail.value = '';
    mostrarToast('¡Enlace de acceso enviado! Revisá tu correo.', 'success');
  } catch (err) {
    console.error('Error enviando enlace OTP:', err);
    mostrarToast(`No se pudo enviar el enlace: ${err.message}`, 'error');
  }
}

export async function cerrarSesion() {
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
    usuarioActual = null;
    actualizarUIUsuario();
    renderizarDashboard();
    mostrarToast('Sesión cerrada.', 'info');
  } catch (err) {
    console.error('Error cerrando sesión:', err);
  }
}

/* ==========================================================================
   Estado de la Aplicación en Memoria y LocalStorage
   ========================================================================== */
export let listaPrecios = [];
export let listaComercios = [];
let vistaActual = 'recientes'; // 'recientes' | 'comparador' | 'comercios'
let html5QrCode = null;
let escanerActivo = false;
let toastTimeout = null;
let realtimeChannelPrecios = null;
let realtimeChannelComercios = null;

const LOCAL_STORAGE_KEY = 'changocheck_precios_cache';
const LOCAL_STORAGE_COMERCIOS = 'changocheck_comercios_list';
const LOCAL_STORAGE_COMERCIO = 'changocheck_last_comercio';

const COMERCIOS_DEFAULT = [
  { id: 1, nombre: 'Coto', ubicacion: 'Sucursal Central', descripcion: 'Supermercado e Hipermercado' },
  { id: 2, nombre: 'Carrefour', ubicacion: 'Sucursal Express', descripcion: 'Supermercado' },
  { id: 3, nombre: 'ChangoMás', ubicacion: 'Sucursal Mayorista', descripcion: 'Hipermercado' }
];

/* ==========================================================================
   Elementos del DOM
   ========================================================================== */
// Header y Estado
const statusLabel = document.getElementById('status-label');
const statusBadge = document.getElementById('status-badge');
const toastEl = document.getElementById('toast');

// Autenticación en Header y Modal
const btnLoginOpen = document.getElementById('btn-login-open');
const userPill = document.getElementById('user-pill');
const userAvatarBox = document.getElementById('user-avatar-box');
const userNameLabel = document.getElementById('user-name-label');
const btnLogout = document.getElementById('btn-logout');

const modalAuthBackdrop = document.getElementById('modal-auth-backdrop');
const btnCerrarAuth = document.getElementById('btn-cerrar-auth');
const btnAuthGoogle = document.getElementById('btn-auth-google');
const btnAuthFacebook = document.getElementById('btn-auth-facebook');
const formAuthEmail = document.getElementById('form-auth-email');
const inputAuthEmail = document.getElementById('input-auth-email');

// Banner y KPIs
const btnBannerScan = document.getElementById('btn-banner-scan');
const kpiTotalPrecios = document.getElementById('kpi-total-precios');
const kpiTotalComercios = document.getElementById('kpi-total-comercios');
const kpiTotalProductos = document.getElementById('kpi-total-productos');

// Segmented Control Tabs
const tabRecientes = document.getElementById('tab-recientes');
const tabComparador = document.getElementById('tab-comparador');
const tabComercios = document.getElementById('tab-comercios');

// Vistas
const viewRecientes = document.getElementById('view-recientes');
const viewComparador = document.getElementById('view-comparador');
const viewComercios = document.getElementById('view-comercios');
const inputBuscar = document.getElementById('input-buscar');

// Contenedores de Listas
const contenedorRecientes = document.getElementById('lista-precios');
const contenedorComparador = document.getElementById('lista-comparador');
const contenedorComercios = document.getElementById('lista-comercios');
const badgePreciosCount = document.getElementById('precios-count');
const badgeComparadorCount = document.getElementById('comparador-count');
const badgeComerciosCount = document.getElementById('comercios-count');

// FAB y Modal Bottom Sheet de Precio
const btnFabCarga = document.getElementById('btn-fab-carga');
const sheetBackdrop = document.getElementById('sheet-backdrop');
const btnCerrarSheet = document.getElementById('btn-cerrar-sheet');

// Escáner y Formulario de Precios
const scannerSection = document.getElementById('scanner-section');
const btnToggleScan = document.getElementById('btn-toggle-scan');
const btnCerrarEscaner = document.getElementById('btn-cerrar-escaner');
const btnCancelarEscaner = document.getElementById('btn-cancelar-escaner');
const btnScanText = document.getElementById('btn-scan-text');

const formPrecio = document.getElementById('form-precio');
const inputCodigo = document.getElementById('codigo-barra');
const selectComercio = document.getElementById('select-comercio');
const btnNuevoComercioForm = document.getElementById('btn-nuevo-comercio-form');
const btnEditarComercioBtn = document.getElementById('btn-editar-comercio-btn');
const btnNuevoComercioTab = document.getElementById('btn-nuevo-comercio-tab');

const inputProducto = document.getElementById('producto');
const inputPrecio = document.getElementById('precio-total');
const inputCantidad = document.getElementById('cantidad');
const selectUnidad = document.getElementById('unidad');
const previewValor = document.getElementById('precio-unitario-val');
const btnGuardar = document.getElementById('btn-guardar');

// Modal de Comercios
const modalComercioBackdrop = document.getElementById('modal-comercio-backdrop');
const modalComercioTitle = document.getElementById('modal-comercio-title');
const btnCerrarModalComercio = document.getElementById('btn-cerrar-modal-comercio');
const btnCancelarComercio = document.getElementById('btn-cancelar-comercio');
const formComercio = document.getElementById('form-comercio');
const inputComercioId = document.getElementById('comercio-id');
const inputComercioNombre = document.getElementById('comercio-nombre');
const inputComercioUbicacion = document.getElementById('comercio-ubicacion');
const inputComercioDescripcion = document.getElementById('comercio-descripcion');

/* ==========================================================================
   Utilidades y Feedback Accesible
   ========================================================================== */
export function mostrarToast(mensaje, tipo = 'info') {
  if (!toastEl) return;
  toastEl.textContent = mensaje;
  toastEl.className = `toast toast-${tipo}`;
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.className = 'toast hidden';
  }, 3200);
}

export function ejecutarFeedbackHaptico() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([70, 40, 70]);
    } catch (err) {
      console.warn('Vibración no permitida:', err);
    }
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   Caché Local para Resiliencia Offline (CA-08)
   ========================================================================== */
function guardarCacheLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(listaPrecios));
    localStorage.setItem(LOCAL_STORAGE_COMERCIOS, JSON.stringify(listaComercios));
  } catch (e) {
    console.warn('Error guardando caché:', e);
  }
}

function recuperarCacheLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function recuperarCacheComercios() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_COMERCIOS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/* ==========================================================================
   Gestión de Comercios (Select dinámico, Crear y Editar)
   ========================================================================== */
export async function cargarComerciosIniciales() {
  // Cargar de caché local
  const enCache = recuperarCacheComercios();
  if (enCache && enCache.length > 0) {
    listaComercios = enCache;
  } else {
    listaComercios = [...COMERCIOS_DEFAULT];
  }
  poblarSelectComercios();

  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('comercios')
      .select('*')
      .order('nombre', { ascending: true });

    if (!error && data && data.length > 0) {
      listaComercios = data;
      guardarCacheLocal();
      poblarSelectComercios();
    }
  } catch (err) {
    console.warn('Aviso al cargar comercios desde Supabase (usando caché):', err);
  }
}

export function poblarSelectComercios(seleccionado = null) {
  if (!selectComercio) return;

  const anterior = seleccionado || selectComercio.value || localStorage.getItem(LOCAL_STORAGE_COMERCIO);

  // Asegurar que los comercios presentes en la lista de precios también existan
  const nombresSet = new Set(listaComercios.map((c) => c.nombre.trim()));
  listaPrecios.forEach((p) => {
    if (p.comercio && !nombresSet.has(p.comercio.trim())) {
      listaComercios.push({
        id: 'local-' + Date.now(),
        nombre: p.comercio.trim(),
        ubicacion: '',
        descripcion: ''
      });
      nombresSet.add(p.comercio.trim());
    }
  });

  // Ordenar por nombre
  listaComercios.sort((a, b) => a.nombre.localeCompare(b.nombre));

  let html = `<option value="" disabled ${!anterior ? 'selected' : ''}>Seleccioná un comercio...</option>`;
  listaComercios.forEach((c) => {
    const isSelected = anterior && anterior.toLowerCase() === c.nombre.toLowerCase();
    const infoExtra = c.ubicacion ? ` (${escapeHTML(c.ubicacion)})` : '';
    html += `<option value="${escapeHTML(c.nombre)}" ${isSelected ? 'selected' : ''}>${escapeHTML(c.nombre)}${infoExtra}</option>`;
  });

  selectComercio.innerHTML = html;
}

export function abrirModalComercio(comercioParaEditar = null) {
  if (!modalComercioBackdrop) return;

  if (comercioParaEditar) {
    modalComercioTitle.textContent = 'Editar Comercio';
    inputComercioId.value = comercioParaEditar.id || '';
    inputComercioNombre.value = comercioParaEditar.nombre || '';
    inputComercioUbicacion.value = comercioParaEditar.ubicacion || '';
    inputComercioDescripcion.value = comercioParaEditar.descripcion || '';
  } else {
    modalComercioTitle.textContent = 'Nuevo Comercio';
    formComercio?.reset();
    inputComercioId.value = '';
  }

  modalComercioBackdrop.classList.remove('hidden');
  setTimeout(() => inputComercioNombre?.focus(), 150);
}

export function cerrarModalComercio() {
  if (modalComercioBackdrop) {
    modalComercioBackdrop.classList.add('hidden');
  }
  formComercio?.reset();
}

export async function guardarComercio(e) {
  e.preventDefault();

  const id = inputComercioId?.value.trim();
  const nombre = inputComercioNombre?.value.trim();
  const ubicacion = inputComercioUbicacion?.value.trim() || null;
  const descripcion = inputComercioDescripcion?.value.trim() || null;

  if (!nombre) {
    mostrarToast('El nombre del comercio es obligatorio.', 'error');
    return;
  }

  if (!usuarioActual) {
    mostrarToast('Iniciá sesión para dar de alta o editar comercios.', 'info');
    abrirModalAuth();
    return;
  }

  const datosComercio = { nombre, ubicacion, descripcion };

  try {
    if (supabase) {
      if (id && !id.startsWith('local-')) {
        // Actualizar comercio existente
        const { error } = await supabase
          .from('comercios')
          .update(datosComercio)
          .eq('id', id);

        if (error) throw error;
      } else {
        // Insertar nuevo comercio
        const insertPayload = {
          ...datosComercio,
          ...(usuarioActual?.id ? { user_id: usuarioActual.id } : {})
        };
        const { data, error } = await supabase
          .from('comercios')
          .insert([insertPayload])
          .select();

        if (error) throw error;
        if (data && data[0]) {
          datosComercio.id = data[0].id;
        }
      }
    }

    // Actualizar estado local
    const index = listaComercios.findIndex((c) => (id && c.id == id) || c.nombre.toLowerCase() === nombre.toLowerCase());
    if (index >= 0) {
      listaComercios[index] = { ...listaComercios[index], ...datosComercio };
    } else {
      listaComercios.push({ id: id || Date.now(), ...datosComercio });
    }

    guardarCacheLocal();
    poblarSelectComercios(nombre);
    localStorage.setItem(LOCAL_STORAGE_COMERCIO, nombre);

    cerrarModalComercio();
    renderizarDashboard();
    mostrarToast(`Comercio "${nombre}" guardado con éxito.`, 'success');

  } catch (err) {
    console.warn('Error al guardar comercio en Supabase (guardado en caché local):', err);
    // Guardar en memoria y caché local aunque la tabla no esté lista aún en Supabase
    const index = listaComercios.findIndex((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (index >= 0) {
      listaComercios[index] = { ...listaComercios[index], ...datosComercio };
    } else {
      listaComercios.push({ id: Date.now(), ...datosComercio });
    }
    guardarCacheLocal();
    poblarSelectComercios(nombre);
    localStorage.setItem(LOCAL_STORAGE_COMERCIO, nombre);

    cerrarModalComercio();
    renderizarDashboard();
    mostrarToast(`Comercio "${nombre}" guardado localmente.`, 'success');
  }
}

/* ==========================================================================
   Normalización de Precio Unitario (CA-04)
   ========================================================================== */
export function normalizarPrecioUnitario(precioTotal, cantidad, unidad) {
  if (!precioTotal || precioTotal <= 0 || !cantidad || cantidad <= 0) {
    return { precioUnitario: 0, unidadBase: 'un' };
  }

  let precioUnitario = 0;
  let unidadBase = 'un';

  switch (unidad) {
    case 'kg':
      precioUnitario = precioTotal / cantidad;
      unidadBase = 'kg';
      break;
    case 'g':
      precioUnitario = (precioTotal / cantidad) * 1000;
      unidadBase = 'kg';
      break;
    case 'l':
      precioUnitario = precioTotal / cantidad;
      unidadBase = 'l';
      break;
    case 'ml':
      precioUnitario = (precioTotal / cantidad) * 1000;
      unidadBase = 'l';
      break;
    case 'un':
    default:
      precioUnitario = precioTotal / cantidad;
      unidadBase = 'un';
      break;
  }

  return {
    precioUnitario: Number(precioUnitario.toFixed(2)),
    unidadBase
  };
}

export function actualizarPreviewUnitario() {
  if (!previewValor) return;
  const precio = parseFloat(inputPrecio?.value);
  const cantidad = parseFloat(inputCantidad?.value);
  const unidad = selectUnidad?.value;

  if (!precio || precio <= 0 || !cantidad || cantidad <= 0) {
    previewValor.textContent = '—';
    return;
  }

  const { precioUnitario, unidadBase } = normalizarPrecioUnitario(precio, cantidad, unidad);
  previewValor.textContent = `$${precioUnitario.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${unidadBase}`;
}

/* ==========================================================================
   Autocompletado de Producto (US-02 / CA-03)
   ========================================================================== */
export function buscarAutocompletadoProducto(codigo) {
  if (!codigo || !codigo.trim()) return;
  const limpio = codigo.trim();

  const coincidencia = listaPrecios.find((item) => item.codigo_barra === limpio);
  if (coincidencia && coincidencia.producto) {
    if (inputProducto) {
      inputProducto.value = coincidencia.producto;
      mostrarToast(`Autocompletado: ${coincidencia.producto}`, 'info');
    }
  }
}

/* ==========================================================================
   Gestión del Bottom Sheet Modal y FAB
   ========================================================================== */
export function abrirModalCarga(iniciarCamara = false) {
  if (!sheetBackdrop) return;
  sheetBackdrop.classList.remove('hidden');

  poblarSelectComercios();

  if (iniciarCamara) {
    iniciarEscaner();
  } else {
    setTimeout(() => {
      if (selectComercio?.value) {
        if (inputCodigo) inputCodigo.focus();
      } else {
        if (selectComercio) selectComercio.focus();
      }
    }, 150);
  }
}

export async function cerrarModalCarga() {
  if (escanerActivo) {
    await detenerEscaner();
  }
  if (sheetBackdrop) {
    sheetBackdrop.classList.add('hidden');
  }
}

/* ==========================================================================
   Módulo de Cámara y Escaneo de Códigos (T-04)
   ========================================================================== */
export async function iniciarEscaner() {
  if (escanerActivo) return;

  if (typeof Html5Qrcode === 'undefined') {
    mostrarToast('Librería de escaneo no disponible.', 'error');
    return;
  }

  try {
    scannerSection.classList.remove('hidden');
    btnScanText.textContent = 'Cerrar visor';
    escanerActivo = true;

    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('reader');
    }

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.floor(viewfinderWidth * 0.85);
        const height = Math.floor(Math.min(viewfinderHeight * 0.5, 180));
        return { width, height };
      },
      aspectRatio: 1.0,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    const onScanSuccess = async (decodedText) => {
      ejecutarFeedbackHaptico();

      if (inputCodigo) {
        inputCodigo.value = decodedText;
        inputCodigo.dispatchEvent(new Event('input', { bubbles: true }));
        inputCodigo.dispatchEvent(new Event('change', { bubbles: true }));
      }

      mostrarToast(`Código detectado: ${decodedText}`, 'success');
      await detenerEscaner();

      buscarAutocompletadoProducto(decodedText);

      if (selectComercio && !selectComercio.value) {
        selectComercio.focus();
      } else if (inputProducto && !inputProducto.value) {
        inputProducto.focus();
      } else if (inputPrecio) {
        inputPrecio.focus();
      }
    };

    const onScanFailure = () => {};

    try {
      await html5QrCode.start({ facingMode: 'environment' }, config, onScanSuccess, onScanFailure);
    } catch (camError) {
      console.warn('Reintentando con cámara secundaria/webcam:', camError);
      await html5QrCode.start({ facingMode: 'user' }, config, onScanSuccess, onScanFailure);
    }

  } catch (error) {
    console.error('Error al inicializar cámara:', error);
    mostrarToast('No se pudo abrir la cámara. Verificá los permisos.', 'error');
    await detenerEscaner();
  }
}

export async function detenerEscaner() {
  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
      html5QrCode.clear();
    } catch (err) {
      console.warn('Aviso al detener escáner:', err);
    }
  }

  scannerSection?.classList.add('hidden');
  if (btnScanText) btnScanText.textContent = 'Escanear';
  escanerActivo = false;
}

export async function alternarEscaner() {
  if (escanerActivo) {
    await detenerEscaner();
  } else {
    await iniciarEscaner();
  }
}

/* ==========================================================================
   Guardado de Precios (Supabase)
   ========================================================================== */
export async function guardarPrecio(e) {
  e.preventDefault();

  const codigo = inputCodigo?.value.trim() || null;
  const comercio = selectComercio?.value;
  const producto = inputProducto?.value.trim();
  const precioTotal = parseFloat(inputPrecio?.value);
  const cantidad = parseFloat(inputCantidad?.value);
  const unidad = selectUnidad?.value;

  if (!comercio || !producto || isNaN(precioTotal) || precioTotal <= 0 || isNaN(cantidad) || cantidad <= 0) {
    mostrarToast('Completá los campos obligatorios con valores válidos.', 'error');
    return;
  }

  if (!usuarioActual) {
    mostrarToast('Iniciá sesión para registrar precios.', 'info');
    abrirModalAuth();
    return;
  }

  const { precioUnitario } = normalizarPrecioUnitario(precioTotal, cantidad, unidad);

  const nuevoRegistro = {
    codigo_barra: codigo,
    comercio,
    producto,
    precio_total: Number(precioTotal.toFixed(2)),
    cantidad: Number(cantidad.toFixed(3)),
    unidad,
    precio_unitario: precioUnitario,
    ...(usuarioActual?.id ? { user_id: usuarioActual.id } : {})
  };

  btnGuardar.disabled = true;

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('precios')
        .insert([nuevoRegistro])
        .select();

      if (error) throw error;
      mostrarToast('¡Precio registrado en Supabase!', 'success');
      if (data && data[0]) {
        registrarIdComoPropio(data[0].id);
        agregarOActualizarRegistro(data[0]);
      }
    } else {
      const simulado = {
        ...nuevoRegistro,
        id: Date.now(),
        created_at: new Date().toISOString()
      };
      registrarIdComoPropio(simulado.id);
      agregarOActualizarRegistro(simulado);
      mostrarToast('Guardado localmente', 'success');
    }

    // Regla US-04 / CA-05: Conservar el comercio seleccionado
    try {
      localStorage.setItem(LOCAL_STORAGE_COMERCIO, comercio);
    } catch (e) {}

    if (inputCodigo) inputCodigo.value = '';
    if (inputProducto) inputProducto.value = '';
    if (inputPrecio) inputPrecio.value = '';
    if (inputCantidad) inputCantidad.value = '1';
    actualizarPreviewUnitario();

    await cerrarModalCarga();

  } catch (err) {
    console.error('Error al guardar:', err);
    mostrarToast(`Error: ${err.message || 'Fallo de conexión'}`, 'error');
  } finally {
    btnGuardar.disabled = false;
  }
}

/* ==========================================================================
   Sincronización Realtime y Gestión de Estado (T-06)
   ========================================================================== */
export function agregarOActualizarRegistro(registro) {
  const index = listaPrecios.findIndex((item) => item.id === registro.id);
  if (index >= 0) {
    listaPrecios[index] = registro;
  } else {
    listaPrecios.unshift(registro);
  }

  listaPrecios.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  guardarCacheLocal();
  renderizarDashboard();
}

export function eliminarRegistroPorId(id) {
  listaPrecios = listaPrecios.filter((item) => String(item.id) !== String(id));
  guardarCacheLocal();
  renderizarDashboard();
}

export async function eliminarPrecio(id) {
  if (!confirm('¿Deseas eliminar este registro de precio?')) return;

  try {
    if (supabase) {
      const { error } = await supabase
        .from('precios')
        .delete()
        .eq('id', id);

      if (error) throw error;
      removerIdDePropios(id);
      eliminarRegistroPorId(id);
      mostrarToast('Precio eliminado', 'info');
    } else {
      removerIdDePropios(id);
      eliminarRegistroPorId(id);
      mostrarToast('Registro eliminado localmente', 'info');
    }
  } catch (err) {
    console.error('Error al eliminar:', err);
    mostrarToast(`No tenés permisos para eliminar este registro: ${err.message || 'Acceso denegado'}`, 'error');
  }
}

export async function cargarPreciosIniciales() {
  const cacheLocal = recuperarCacheLocal();
  if (cacheLocal.length > 0) {
    listaPrecios = cacheLocal;
    renderizarDashboard();
  }

  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('precios')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (data) {
      listaPrecios = data;
      guardarCacheLocal();
      renderizarDashboard();
    }
  } catch (err) {
    console.warn('Error en carga inicial de precios:', err);
    renderizarDashboard();
  }
}

export function suscribirRealtime() {
  if (!supabase) return;

  try {
    // Canal de precios
    if (realtimeChannelPrecios) {
      supabase.removeChannel(realtimeChannelPrecios);
    }

    realtimeChannelPrecios = supabase
      .channel('public:precios')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'precios' },
        (payload) => {
          agregarOActualizarRegistro(payload.new);
          mostrarToast(`Nuevo precio: ${payload.new.producto} ($${payload.new.precio_total})`, 'info');
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'precios' },
        (payload) => {
          eliminarRegistroPorId(payload.old.id);
        }
      )
      .subscribe((status) => {
        if (statusLabel) {
          if (status === 'SUBSCRIBED') {
            statusLabel.textContent = 'En vivo';
            statusBadge?.classList.add('status-online');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            statusLabel.textContent = 'Desconectado';
          }
        }
      });

    // Canal de comercios
    if (realtimeChannelComercios) {
      supabase.removeChannel(realtimeChannelComercios);
    }

    realtimeChannelComercios = supabase
      .channel('public:comercios')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comercios' },
        () => {
          cargarComerciosIniciales();
        }
      )
      .subscribe();

  } catch (e) {
    console.warn('Error en Realtime:', e);
  }
}

/* ==========================================================================
   Dashboard de Inicio: KPIs, Segmented Control y Vistas
   ========================================================================== */
export function cambiarVista(nuevaVista) {
  vistaActual = nuevaVista;

  [tabRecientes, tabComparador, tabComercios].forEach((tab) => tab?.classList.remove('active'));
  [viewRecientes, viewComparador, viewComercios].forEach((v) => v?.classList.add('hidden'));

  if (nuevaVista === 'recientes') {
    tabRecientes?.classList.add('active');
    viewRecientes?.classList.remove('hidden');
  } else if (nuevaVista === 'comparador') {
    tabComparador?.classList.add('active');
    viewComparador?.classList.remove('hidden');
  } else if (nuevaVista === 'comercios') {
    tabComercios?.classList.add('active');
    viewComercios?.classList.remove('hidden');
  }

  renderizarDashboard();
}

export function actualizarKPIs() {
  const total = listaPrecios.length;
  const comerciosUnicos = new Set(listaPrecios.map((p) => p.comercio?.trim().toLowerCase())).size;
  const productosUnicos = new Set(listaPrecios.map((p) => p.producto?.trim().toLowerCase())).size;

  if (kpiTotalPrecios) kpiTotalPrecios.textContent = total;
  if (kpiTotalComercios) kpiTotalComercios.textContent = Math.max(comerciosUnicos, listaComercios.length);
  if (kpiTotalProductos) kpiTotalProductos.textContent = productosUnicos;
}

export function renderizarDashboard() {
  actualizarKPIs();

  if (vistaActual === 'recientes') {
    renderizarListaRecientes();
  } else if (vistaActual === 'comparador') {
    renderizarComparador();
  } else if (vistaActual === 'comercios') {
    renderizarPorComercio();
  }
}

/* Vista 1: Recientes */
export function renderizarListaRecientes() {
  if (!contenedorRecientes) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';

  const filtrados = listaPrecios.filter((item) => {
    if (!termino) return true;
    return (
      item.producto?.toLowerCase().includes(termino) ||
      item.comercio?.toLowerCase().includes(termino) ||
      item.codigo_barra?.toLowerCase().includes(termino)
    );
  });

  if (badgePreciosCount) {
    badgePreciosCount.textContent = `${filtrados.length} ${filtrados.length === 1 ? 'registro' : 'registros'}`;
  }

  if (filtrados.length === 0) {
    contenedorRecientes.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${termino ? '🔍' : '🛒'}</div>
        <p class="empty-title">${termino ? 'Sin coincidencias' : 'Sin precios relevados'}</p>
        <p class="empty-desc">${termino ? `No encontramos resultados para "${termino}"` : 'Tocá el botón (+) o "Escanear ahora" para registrar tu primer precio.'}</p>
      </div>
    `;
    return;
  }

  contenedorRecientes.innerHTML = filtrados.map((item) => {
    const precioTotalFmt = Number(item.precio_total).toLocaleString('es-AR', { minimumFractionDigits: 2 });
    const precioUnitFmt = Number(item.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 });
    const unidadBase = (item.unidad === 'g' || item.unidad === 'kg') ? 'kg'
      : (item.unidad === 'ml' || item.unidad === 'l') ? 'l' : 'un';

    // Determinar si el registro pertenece al usuario actual para permitir eliminar
    const esMio = (usuarioActual && item.user_id && item.user_id === usuarioActual.id) ||
                  misPreciosLocales.has(String(item.id));

    return `
      <article class="price-card" data-id="${item.id}">
        <div class="price-card-header">
          <div class="price-card-info">
            <h3 class="price-card-title">${escapeHTML(item.producto)}</h3>
            <div class="price-card-badges">
              <span class="badge-comercio">${escapeHTML(item.comercio)}</span>
              ${item.codigo_barra ? `<span class="badge-codigo">#${escapeHTML(item.codigo_barra)}</span>` : ''}
              ${esMio ? `<span class="badge-autor" title="Cargado por vos">👤 Mi carga</span>` : ''}
            </div>
          </div>
          ${esMio ? `
            <button type="button" class="btn-delete-item" title="Eliminar registro" data-delete-id="${item.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
        <div class="price-card-pricing">
          <div class="price-total-wrap">
            <span class="price-total-number">$${precioTotalFmt}</span>
            <span class="price-qty-text">(${item.cantidad} ${item.unidad})</span>
          </div>
          <div class="price-unit-tag">$${precioUnitFmt} / ${unidadBase}</div>
        </div>
      </article>
    `;
  }).join('');

  contenedorRecientes.querySelectorAll('.btn-delete-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      if (id) eliminarPrecio(id);
    });
  });
}

/* Vista 2: Comparador de Precios */
export function renderizarComparador() {
  if (!contenedorComparador) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';

  const grupos = {};
  listaPrecios.forEach((item) => {
    const key = item.producto?.trim().toLowerCase();
    if (!key) return;
    if (termino && !key.includes(termino) && !item.comercio?.toLowerCase().includes(termino)) {
      return;
    }
    if (!grupos[key]) {
      grupos[key] = {
        nombre: item.producto,
        codigo: item.codigo_barra,
        items: []
      };
    }
    grupos[key].items.push(item);
  });

  const arrayGrupos = Object.values(grupos);
  if (badgeComparadorCount) {
    badgeComparadorCount.textContent = `${arrayGrupos.length} ${arrayGrupos.length === 1 ? 'producto' : 'productos'}`;
  }

  if (arrayGrupos.length === 0) {
    contenedorComparador.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏆</div>
        <p class="empty-title">Sin productos para comparar</p>
        <p class="empty-desc">Cargá el mismo producto en distintos comercios para ver cuál tiene el mejor precio unitario.</p>
      </div>
    `;
    return;
  }

  contenedorComparador.innerHTML = arrayGrupos.map((grupo) => {
    const ordenados = [...grupo.items].sort((a, b) => a.precio_unitario - b.precio_unitario);
    const mejor = ordenados[0];
    const peor = ordenados[ordenados.length - 1];

    let ahorroHtml = '';
    if (ordenados.length > 1 && peor.precio_unitario > mejor.precio_unitario) {
      const porcentaje = Math.round(((peor.precio_unitario - mejor.precio_unitario) / peor.precio_unitario) * 100);
      ahorroHtml = `<span class="badge-savings">Ahorro de hasta ${porcentaje}%</span>`;
    }

    const unidadBase = (mejor.unidad === 'g' || mejor.unidad === 'kg') ? 'kg'
      : (mejor.unidad === 'ml' || mejor.unidad === 'l') ? 'l' : 'un';

    return `
      <article class="comparator-card">
        <div class="comparator-header">
          <div>
            <h3 class="comparator-title">${escapeHTML(grupo.nombre)}</h3>
            ${grupo.codigo ? `<span class="badge-codigo">#${escapeHTML(grupo.codigo)}</span>` : ''}
          </div>
          ${ahorroHtml}
        </div>

        <div class="comparator-table">
          ${ordenados.map((item, idx) => {
            const esElMejor = idx === 0 && ordenados.length > 1;
            const precioUnitFmt = Number(item.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 });
            const precioTotalFmt = Number(item.precio_total).toLocaleString('es-AR', { minimumFractionDigits: 2 });

            return `
              <div class="comparator-row ${esElMejor ? 'best-price' : ''}">
                <div class="store-name-wrap">
                  <span class="store-name">${escapeHTML(item.comercio)}</span>
                  ${esElMejor ? `<span class="badge-best-store">MÁS BARATO</span>` : ''}
                </div>
                <div class="store-prices">
                  <span class="store-unit-price">$${precioUnitFmt} / ${unidadBase}</span>
                  <span class="store-total-price">($${precioTotalFmt} por ${item.cantidad} ${item.unidad})</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </article>
    `;
  }).join('');
}

/* Vista 3: Por Comercio (con detalles y edición) */
export function renderizarPorComercio() {
  if (!contenedorComercios) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';

  // Reunir comercios registrados en listaComercios y los que tengan precios
  const mapaComercios = new Map();
  listaComercios.forEach((c) => mapaComercios.set(c.nombre.trim(), c));
  listaPrecios.forEach((p) => {
    if (p.comercio && !mapaComercios.has(p.comercio.trim())) {
      mapaComercios.set(p.comercio.trim(), {
        id: null,
        nombre: p.comercio.trim(),
        ubicacion: '',
        descripcion: ''
      });
    }
  });

  // Agrupar precios por comercio
  const grupos = {};
  mapaComercios.forEach((c, nombre) => {
    grupos[nombre] = {
      info: c,
      productos: []
    };
  });

  listaPrecios.forEach((item) => {
    const key = item.comercio?.trim();
    if (key && grupos[key]) {
      grupos[key].productos.push(item);
    }
  });

  // Filtrado por buscador
  const listaFiltrada = Object.values(grupos).filter((g) => {
    if (!termino) return true;
    const matchNombre = g.info.nombre.toLowerCase().includes(termino);
    const matchUbicacion = g.info.ubicacion?.toLowerCase().includes(termino);
    const matchItems = g.productos.some((p) => p.producto.toLowerCase().includes(termino));
    return matchNombre || matchUbicacion || matchItems;
  });

  if (badgeComerciosCount) {
    badgeComerciosCount.textContent = `${listaFiltrada.length} ${listaFiltrada.length === 1 ? 'comercio' : 'comercios'}`;
  }

  if (listaFiltrada.length === 0) {
    contenedorComercios.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏬</div>
        <p class="empty-title">Sin comercios encontrados</p>
        <p class="empty-desc">${termino ? `No hay comercios que coincidan con "${termino}"` : 'Presioná "+ Nuevo Comercio" para dar de alta tu primera sucursal.'}</p>
      </div>
    `;
    return;
  }

  contenedorComercios.innerHTML = listaFiltrada.map((g) => {
    const c = g.info;
    const items = g.productos;

    return `
      <article class="store-group-card">
        <div class="store-group-header">
          <div class="store-group-title">
            <span>🏬</span>
            <span>${escapeHTML(c.nombre)}</span>
          </div>
          <div class="store-header-actions">
            <span class="store-items-count">${items.length} ${items.length === 1 ? 'artículo' : 'artículos'}</span>
            <button type="button" class="btn-text-action btn-editar-tienda" data-nombre="${escapeHTML(c.nombre)}" title="Editar detalles del comercio">
              ✏️ Editar
            </button>
          </div>
        </div>

        ${(c.ubicacion || c.descripcion) ? `
          <div class="store-details-badge">
            ${c.ubicacion ? `<span class="store-location-text">📍 ${escapeHTML(c.ubicacion)}</span>` : ''}
            ${c.descripcion ? `<span class="store-desc-text">ℹ️ ${escapeHTML(c.descripcion)}</span>` : ''}
          </div>
        ` : ''}

        <div class="store-group-items">
          ${items.length === 0 ? `
            <span class="empty-desc" style="padding: 6px 0;">Sin precios cargados en esta sucursal aún.</span>
          ` : items.map((item) => {
            const precioTotalFmt = Number(item.precio_total).toLocaleString('es-AR', { minimumFractionDigits: 2 });
            return `
              <div class="store-item-row">
                <span class="store-item-name">${escapeHTML(item.producto)}</span>
                <span class="store-item-price">$${precioTotalFmt}</span>
              </div>
            `;
          }).join('')}
        </div>
      </article>
    `;
  }).join('');

  // Event listeners para editar comercios desde la lista
  contenedorComercios.querySelectorAll('.btn-editar-tienda').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nom = btn.getAttribute('data-nombre');
      const encontrado = listaComercios.find((c) => c.nombre === nom) || { nombre: nom };
      abrirModalComercio(encontrado);
    });
  });
}

/* ==========================================================================
   Inicialización de Eventos del DOM
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Navegación de Vistas (Segmented Control)
  tabRecientes?.addEventListener('click', () => cambiarVista('recientes'));
  tabComparador?.addEventListener('click', () => cambiarVista('comparador'));
  tabComercios?.addEventListener('click', () => cambiarVista('comercios'));

  // Buscador reactivo
  inputBuscar?.addEventListener('input', () => renderizarDashboard());

  // Eventos de Autenticación
  btnLoginOpen?.addEventListener('click', abrirModalAuth);
  btnCerrarAuth?.addEventListener('click', cerrarModalAuth);
  btnAuthGoogle?.addEventListener('click', () => iniciarSesionOAuth('google'));
  btnAuthFacebook?.addEventListener('click', () => iniciarSesionOAuth('facebook'));
  formAuthEmail?.addEventListener('submit', iniciarSesionEmail);
  btnLogout?.addEventListener('click', cerrarSesion);

  modalAuthBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalAuthBackdrop) cerrarModalAuth();
  });

  // Apertura y Cierre del Bottom Sheet Modal de Precios
  btnFabCarga?.addEventListener('click', () => {
    if (!usuarioActual) {
      mostrarToast('Iniciá sesión para registrar precios', 'info');
      abrirModalAuth();
      return;
    }
    abrirModalCarga(false);
  });

  btnBannerScan?.addEventListener('click', () => {
    if (!usuarioActual) {
      mostrarToast('Iniciá sesión para escanear y registrar precios', 'info');
      abrirModalAuth();
      return;
    }
    abrirModalCarga(true);
  });

  btnCerrarSheet?.addEventListener('click', cerrarModalCarga);

  sheetBackdrop?.addEventListener('click', (e) => {
    if (e.target === sheetBackdrop) cerrarModalCarga();
  });

  // Eventos de Gestión de Comercios
  btnNuevoComercioForm?.addEventListener('click', () => abrirModalComercio(null));
  btnNuevoComercioTab?.addEventListener('click', () => abrirModalComercio(null));
  btnCerrarModalComercio?.addEventListener('click', cerrarModalComercio);
  btnCancelarComercio?.addEventListener('click', cerrarModalComercio);
  formComercio?.addEventListener('submit', guardarComercio);

  btnEditarComercioBtn?.addEventListener('click', () => {
    const actual = selectComercio?.value;
    if (actual) {
      const c = listaComercios.find((item) => item.nombre === actual) || { nombre: actual };
      abrirModalComercio(c);
    } else {
      abrirModalComercio(null);
    }
  });

  selectComercio?.addEventListener('change', (e) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_COMERCIO, e.target.value);
    } catch (err) {}
  });

  modalComercioBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalComercioBackdrop) cerrarModalComercio();
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalAuthBackdrop?.classList.contains('hidden')) {
        cerrarModalAuth();
      } else if (!modalComercioBackdrop?.classList.contains('hidden')) {
        cerrarModalComercio();
      } else if (!sheetBackdrop?.classList.contains('hidden')) {
        cerrarModalCarga();
      }
    }
  });

  // Eventos de Cámara
  btnToggleScan?.addEventListener('click', alternarEscaner);
  btnCerrarEscaner?.addEventListener('click', detenerEscaner);
  btnCancelarEscaner?.addEventListener('click', detenerEscaner);

  // Formulario de Precios y Preview Unitario
  formPrecio?.addEventListener('submit', guardarPrecio);
  inputPrecio?.addEventListener('input', actualizarPreviewUnitario);
  inputCantidad?.addEventListener('input', actualizarPreviewUnitario);
  selectUnidad?.addEventListener('change', actualizarPreviewUnitario);

  // Autocompletado de Código
  inputCodigo?.addEventListener('input', (e) => {
    buscarAutocompletadoProducto(e.target.value);
  });

  // Carga inicial, sesión anónima y Suscripciones Realtime
  inicializarSesion().finally(() => {
    cargarComerciosIniciales();
    cargarPreciosIniciales();
    suscribirRealtime();
  });
});
