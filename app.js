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
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);

    const codigoInvitacionUrl = searchParams.get('hogar');
    if (codigoInvitacionUrl) {
      try {
        sessionStorage.setItem('changocheck_pending_hogar', codigoInvitacionUrl.trim().toUpperCase());
      } catch (e) {}
      searchParams.delete('hogar');
      const nuevaQuery = searchParams.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (nuevaQuery ? `?${nuevaQuery}` : ''));
    }

    // Verificar si la URL trae errores de redirección OAuth (ej: proveedor desactivado en Supabase)
    const oauthError = hashParams.get('error_description') || searchParams.get('error_description') || hashParams.get('error');
    if (oauthError) {
      const msgDecodificado = decodeURIComponent(oauthError.replace(/\+/g, ' '));
      if (msgDecodificado.toLowerCase().includes('provider is not enabled')) {
        mostrarToast('Activá ese proveedor en Supabase Dashboard (Authentication → Providers) o ingresá con tu correo.', 'error');
      } else {
        mostrarToast(`Error de autenticación: ${msgDecodificado}`, 'error');
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: { session } } = await supabase.auth.getSession();
    usuarioActual = session?.user || null;
    actualizarUIUsuario();

    // Escuchar cambios de sesión (cuando el usuario regresa del redirect de Google o Facebook)
    supabase.auth.onAuthStateChange(async (event, session) => {
      usuarioActual = session?.user || null;
      actualizarUIUsuario();
      renderizarDashboard();
      if (event === 'SIGNED_IN' && usuarioActual) {
        cerrarModalAuth();
        await procesarInvitacionPendiente();
        await cargarHogarInicial();
        await cargarChangoInicial();
        await cargarHistorialInicial();
        await cargarStockInicial();
        suscribirRealtimeHogar();
      } else if (event === 'SIGNED_OUT') {
        hogarActual = null;
        miembrosHogar = [];
        listaHistorial = recuperarHistorialLocal();
        actualizarUIHogar();
        if (vistaActual === 'chango') renderizarHistorial();
        suscribirRealtimeHogar();
      }
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
    if (err.message?.toLowerCase().includes('provider is not enabled')) {
      mostrarToast(`El proveedor ${provider} no está activado aún en Supabase. Podés ingresar con correo y contraseña.`, 'error');
    } else {
      mostrarToast(`Error al iniciar con ${provider}: ${err.message}`, 'error');
    }
  }
}

export async function iniciarSesionMagicLink() {
  const email = inputAuthEmail?.value.trim();
  if (!email) {
    mostrarToast('Ingresá tu correo electrónico primero.', 'error');
    inputAuthEmail?.focus();
    return;
  }

  if (!supabase) {
    mostrarToast('Supabase no está conectado.', 'error');
    return;
  }

  if (btnAuthMagicLink) btnAuthMagicLink.disabled = true;
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
    if (inputAuthPassword) inputAuthPassword.value = '';
    mostrarToast('¡Enlace mágico enviado! Revisá tu bandeja de entrada.', 'success');
  } catch (err) {
    console.error('Error enviando enlace OTP:', err);
    mostrarToast(`No se pudo enviar el enlace: ${err.message}`, 'error');
  } finally {
    if (btnAuthMagicLink) btnAuthMagicLink.disabled = false;
  }
}

export async function iniciarSesionEmail(e) {
  e?.preventDefault();
  const email = inputAuthEmail?.value.trim();
  const password = inputAuthPassword?.value || '';

  if (!email) {
    mostrarToast('Por favor ingresá un correo válido.', 'error');
    return;
  }

  // Si no ingresó contraseña, enviar Magic Link
  if (!password) {
    await iniciarSesionMagicLink();
    return;
  }

  if (password.length < 6) {
    mostrarToast('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }

  if (!supabase) {
    mostrarToast('Supabase no está conectado.', 'error');
    return;
  }

  if (btnAuthPasswordSubmit) btnAuthPasswordSubmit.disabled = true;

  try {
    // 1. Intentar iniciar sesión con correo y contraseña
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (!signInError && signInData?.user) {
      usuarioActual = signInData.user;
      actualizarUIUsuario();
      renderizarDashboard();
      cerrarModalAuth();
      if (inputAuthEmail) inputAuthEmail.value = '';
      if (inputAuthPassword) inputAuthPassword.value = '';
      mostrarToast('¡Sesión iniciada con éxito!', 'success');
      return;
    }

    // 2. Si las credenciales no existen aún, intentar registrar la cuenta automáticamente
    if (signInError && signInError.message?.toLowerCase().includes('invalid login credentials')) {
      const redirectUrl = window.location.origin + window.location.pathname;
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (signUpError) {
        if (signUpError.message?.toLowerCase().includes('already registered')) {
          throw new Error('Contraseña incorrecta para este correo.');
        }
        throw signUpError;
      }

      if (signUpData?.session && signUpData?.user) {
        usuarioActual = signUpData.user;
        actualizarUIUsuario();
        renderizarDashboard();
        cerrarModalAuth();
        if (inputAuthEmail) inputAuthEmail.value = '';
        if (inputAuthPassword) inputAuthPassword.value = '';
        mostrarToast('¡Cuenta creada y sesión iniciada!', 'success');
        return;
      }

      // Si Supabase requiere confirmación por email pero devuelve identidades vacías, el usuario ya existía
      if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        throw new Error('Contraseña incorrecta para este correo.');
      }

      cerrarModalAuth();
      if (inputAuthEmail) inputAuthEmail.value = '';
      if (inputAuthPassword) inputAuthPassword.value = '';
      mostrarToast('¡Cuenta creada! Revisá tu correo para confirmar el acceso.', 'success');
      return;
    }

    if (signInError) throw signInError;
  } catch (err) {
    console.error('Error en autenticación por correo:', err);
    mostrarToast(`Error: ${err.message}`, 'error');
  } finally {
    if (btnAuthPasswordSubmit) btnAuthPasswordSubmit.disabled = false;
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
export let listaChango = [];
export let listaHistorial = [];
export let listaStock = [];
export let hogarActual = null;
export let miembrosHogar = [];
let presupuestoChango = 0;
let filtroStock = 'todos'; // 'todos' | 'bajo'
let vistaActual = 'recientes'; // 'recientes' | 'comparador' | 'comercios' | 'chango' | 'stock'
let html5QrCode = null;
let escanerActivo = false;
let html5QrCodeStock = null;
let escanerStockActivo = false;
let toastTimeout = null;
let realtimeChannelPrecios = null;
let realtimeChannelComercios = null;
let realtimeChannelChango = null;
let realtimeChannelHistorial = null;
let realtimeChannelStock = null;

const LOCAL_STORAGE_KEY = 'changocheck_precios_cache';
const LOCAL_STORAGE_COMERCIOS = 'changocheck_comercios_list';
const LOCAL_STORAGE_COMERCIO = 'changocheck_last_comercio';
const LOCAL_STORAGE_CHANGO = 'changocheck_chango_cache';
const LOCAL_STORAGE_CHANGO_BUDGET = 'changocheck_chango_budget';
const LOCAL_STORAGE_HISTORIAL = 'changocheck_historial_cache';
const LOCAL_STORAGE_STOCK = 'changocheck_stock_cache';
const LOCAL_STORAGE_HOGAR = 'changocheck_hogar_cache';

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
const inputAuthPassword = document.getElementById('input-auth-password');
const btnAuthPasswordSubmit = document.getElementById('btn-auth-password-submit');
const btnAuthMagicLink = document.getElementById('btn-auth-magiclink');

// Banner y KPIs
const btnBannerScan = document.getElementById('btn-banner-scan');
const kpiTotalPrecios = document.getElementById('kpi-total-precios');
const kpiTotalComercios = document.getElementById('kpi-total-comercios');
const kpiTotalProductos = document.getElementById('kpi-total-productos');

// Segmented Control Tabs
const tabRecientes = document.getElementById('tab-recientes');
const tabComparador = document.getElementById('tab-comparador');
const tabComercios = document.getElementById('tab-comercios');
const tabChango = document.getElementById('tab-chango');
const tabStock = document.getElementById('tab-stock');

// Vistas
const viewRecientes = document.getElementById('view-recientes');
const viewComparador = document.getElementById('view-comparador');
const viewComercios = document.getElementById('view-comercios');
const viewChango = document.getElementById('view-chango');
const viewStock = document.getElementById('view-stock');
const inputBuscar = document.getElementById('input-buscar');

// Contenedores de Listas
const contenedorRecientes = document.getElementById('lista-precios');
const contenedorComparador = document.getElementById('lista-comparador');
const contenedorComercios = document.getElementById('lista-comercios');
const contenedorChango = document.getElementById('lista-chango');
const contenedorStock = document.getElementById('lista-stock');
const badgePreciosCount = document.getElementById('precios-count');
const badgeComparadorCount = document.getElementById('comparador-count');
const badgeComerciosCount = document.getElementById('comercios-count');

// Elementos Vista Mi Chango
const changoTotalGasto = document.getElementById('chango-total-gasto');
const changoItemsCount = document.getElementById('chango-items-count');
const changoUnitsCount = document.getElementById('chango-units-count');
const inputChangoPresupuesto = document.getElementById('input-chango-presupuesto');
const changoBudgetProgressWrap = document.getElementById('chango-budget-progress-wrap');
const changoBudgetBar = document.getElementById('chango-budget-bar');
const changoBudgetText = document.getElementById('chango-budget-text');
const btnChangoAgregar = document.getElementById('btn-chango-agregar');
const btnChangoFinalizar = document.getElementById('btn-chango-finalizar');
const btnChangoVaciar = document.getElementById('btn-chango-vaciar');
const btnChangoCambiarComercio = document.getElementById('btn-chango-cambiar-comercio');
const changoCambiarComercioBar = document.getElementById('chango-cambiar-comercio-bar');
const selectChangoNuevoComercio = document.getElementById('select-chango-nuevo-comercio');
const btnAplicarComercioChango = document.getElementById('btn-aplicar-comercio-chango');
const historialCount = document.getElementById('historial-count');
const listaHistorialEl = document.getElementById('lista-historial');

// Elementos Vista Stock Casa
const btnStockFiltroTodos = document.getElementById('btn-stock-filtro-todos');
const btnStockFiltroBajo = document.getElementById('btn-stock-filtro-bajo');
const stockTotalCount = document.getElementById('stock-total-count');
const stockBajoCount = document.getElementById('stock-bajo-count');
const stockVisibleCount = document.getElementById('stock-visible-count');
const btnStockAgregar = document.getElementById('btn-stock-agregar');

// Elementos Hogar Compartido
const hogarPillChango = document.getElementById('hogar-pill-chango');
const btnHogarChango = document.getElementById('btn-hogar-chango');
const hogarPillStock = document.getElementById('hogar-pill-stock');
const btnHogarStock = document.getElementById('btn-hogar-stock');
const modalHogarBackdrop = document.getElementById('modal-hogar-backdrop');
const btnCerrarModalHogar = document.getElementById('btn-cerrar-modal-hogar');
const hogarSinGrupo = document.getElementById('hogar-sin-grupo');
const hogarActivoEl = document.getElementById('hogar-activo');
const formCrearHogar = document.getElementById('form-crear-hogar');
const inputHogarNombre = document.getElementById('input-hogar-nombre');
const formUnirseHogar = document.getElementById('form-unirse-hogar');
const inputHogarCodigo = document.getElementById('input-hogar-codigo');
const hogarActivoNombre = document.getElementById('hogar-activo-nombre');
const hogarMiembrosCount = document.getElementById('hogar-miembros-count');
const hogarActivoCodigo = document.getElementById('hogar-activo-codigo');
const btnHogarCopiar = document.getElementById('btn-hogar-copiar');
const btnHogarCompartir = document.getElementById('btn-hogar-compartir');
const listaHogarMiembros = document.getElementById('lista-hogar-miembros');
const btnHogarRegenerar = document.getElementById('btn-hogar-regenerar');
const btnHogarSalir = document.getElementById('btn-hogar-salir');

// FAB y Modal Bottom Sheet de Precio
const btnFabCarga = document.getElementById('btn-fab-carga');
const sheetBackdrop = document.getElementById('sheet-backdrop');
const sheetTitle = document.getElementById('sheet-title');
const btnCerrarSheet = document.getElementById('btn-cerrar-sheet');

// Escáner y Formulario de Precios
const scannerSection = document.getElementById('scanner-section');
const btnToggleScan = document.getElementById('btn-toggle-scan');
const btnCerrarEscaner = document.getElementById('btn-cerrar-escaner');
const btnCancelarEscaner = document.getElementById('btn-cancelar-escaner');
const btnScanText = document.getElementById('btn-scan-text');

const formPrecio = document.getElementById('form-precio');
const inputChangoEditId = document.getElementById('chango-edit-id');
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
const btnGuardarText = document.getElementById('btn-guardar-text');
const checkAgregarChango = document.getElementById('check-agregar-chango');
const changoExtrasFields = document.getElementById('chango-extras-fields');
const inputChangoUnidades = document.getElementById('chango-cantidad-unidades');
const checkActualizarPrecioGondola = document.getElementById('check-actualizar-precio-gondola');

// Modal de Stock Casa
const modalStockBackdrop = document.getElementById('modal-stock-backdrop');
const modalStockTitle = document.getElementById('modal-stock-title');
const btnCerrarModalStock = document.getElementById('btn-cerrar-modal-stock');
const btnCancelarStock = document.getElementById('btn-cancelar-stock');
const formStock = document.getElementById('form-stock');
const stockScannerSection = document.getElementById('stock-scanner-section');
const btnScanStock = document.getElementById('btn-scan-stock');
const btnScanStockText = document.getElementById('btn-scan-stock-text');
const btnCerrarEscanerStock = document.getElementById('btn-cerrar-escaner-stock');
const inputStockId = document.getElementById('stock-id');
const inputStockCodigo = document.getElementById('stock-codigo');
const inputStockProducto = document.getElementById('stock-producto');
const inputStockCantidad = document.getElementById('stock-cantidad');
const selectStockUnidad = document.getElementById('stock-unidad');
const inputStockMinimo = document.getElementById('stock-minimo');
const selectStockCategoria = document.getElementById('stock-categoria');

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
  if (selectChangoNuevoComercio) {
    selectChangoNuevoComercio.innerHTML = html;
  }
}

export function abrirModalComercio(comercioParaEditar = null) {
  if (!usuarioActual) {
    mostrarToast('Iniciá sesión para gestionar comercios', 'info');
    abrirModalAuth();
    return;
  }
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

  const comercioActual = selectComercio?.value?.trim().toLowerCase();
  const coincidenciaComercio = comercioActual
    ? listaPrecios.find((item) => item.codigo_barra === limpio && item.comercio?.trim().toLowerCase() === comercioActual)
    : null;
  const coincidencia = coincidenciaComercio || listaPrecios.find((item) => item.codigo_barra === limpio);

  if (coincidencia && coincidencia.producto) {
    if (inputProducto) {
      inputProducto.value = coincidencia.producto;
    }
    if (inputPrecio && !inputPrecio.value && coincidencia.precio_total) {
      inputPrecio.value = coincidencia.precio_total;
    }
    if (inputCantidad && coincidencia.cantidad) {
      inputCantidad.value = coincidencia.cantidad;
    }
    if (selectUnidad && coincidencia.unidad) {
      selectUnidad.value = coincidencia.unidad;
    }
    actualizarPreviewUnitario();
    mostrarToast(`Autocompletado: ${coincidencia.producto}`, 'info');
  }
}

/* ==========================================================================
   Gestión del Bottom Sheet Modal y FAB
   ========================================================================== */
export function abrirModalCarga(iniciarCamara = false, opciones = {}) {
  if (!sheetBackdrop) return;
  sheetBackdrop.classList.remove('hidden');

  poblarSelectComercios(opciones.comercio || null);

  const changoEditId = opciones.changoEditId ? String(opciones.changoEditId) : '';
  const modoChango = Boolean(opciones.modoChango) || Boolean(changoEditId);

  if (inputChangoEditId) inputChangoEditId.value = changoEditId;
  if (sheetTitle) {
    sheetTitle.textContent = changoEditId ? 'Editar Producto del Chango' : 'Registrar Precio';
  }
  if (checkAgregarChango) {
    checkAgregarChango.checked = modoChango;
    changoExtrasFields?.classList.toggle('hidden', !modoChango);
  }
  if (btnGuardarText) {
    btnGuardarText.textContent = changoEditId
      ? 'Guardar Cambios'
      : (modoChango ? 'Agregar al Chango' : 'Guardar Precio');
  }
  if (inputChangoUnidades) {
    inputChangoUnidades.value = opciones.unidadesChango || 1;
  }
  if (checkActualizarPrecioGondola) {
    checkActualizarPrecioGondola.checked = true;
  }

  if (changoEditId) {
    if (inputCodigo) inputCodigo.value = opciones.codigo_barra || '';
    if (inputProducto) inputProducto.value = opciones.producto || '';
    if (inputPrecio) inputPrecio.value = opciones.precio_total ?? '';
    if (inputCantidad) inputCantidad.value = opciones.cantidad || 1;
    if (selectUnidad) selectUnidad.value = opciones.unidad || 'un';
  } else {
    if (opciones.codigo_barra && inputCodigo) inputCodigo.value = opciones.codigo_barra;
    if (opciones.producto && inputProducto) inputProducto.value = opciones.producto;
    if (opciones.precio_total && inputPrecio) inputPrecio.value = opciones.precio_total;
    if (opciones.cantidad && inputCantidad) inputCantidad.value = opciones.cantidad;
    if (opciones.unidad && selectUnidad) selectUnidad.value = opciones.unidad;
  }
  actualizarPreviewUnitario();

  if (iniciarCamara) {
    iniciarEscaner();
  } else {
    setTimeout(() => {
      if (selectComercio?.value) {
        if (opciones.producto && inputPrecio) {
          inputPrecio.focus();
        } else if (inputCodigo) {
          inputCodigo.focus();
        }
      } else if (selectComercio) {
        selectComercio.focus();
      }
    }, 150);
  }
}

export async function cerrarModalCarga() {
  if (escanerActivo) {
    await detenerEscaner();
  }
  if (inputChangoEditId) inputChangoEditId.value = '';
  if (sheetTitle) sheetTitle.textContent = 'Registrar Precio';
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
   Guardado de Precios (Supabase) y Sincronización desde Chango
   ========================================================================== */
export async function registrarPrecioEnBase({ codigo_barra, comercio, producto, precio_total, cantidad, unidad }, silencioso = false) {
  const { precioUnitario } = normalizarPrecioUnitario(precio_total, cantidad, unidad);

  const nuevoRegistro = {
    codigo_barra: codigo_barra || null,
    comercio,
    producto,
    precio_total: Number(Number(precio_total).toFixed(2)),
    cantidad: Number(Number(cantidad).toFixed(3)),
    unidad,
    precio_unitario: precioUnitario,
    ...(usuarioActual?.id ? { user_id: usuarioActual.id } : {})
  };

  if (supabase && usuarioActual) {
    const { data, error } = await supabase
      .from('precios')
      .insert([nuevoRegistro])
      .select();

    if (error) throw error;
    if (data && data[0]) {
      registrarIdComoPropio(data[0].id);
      agregarOActualizarRegistro(data[0]);
    }
    if (!silencioso) mostrarToast('¡Precio registrado en Supabase!', 'success');
  } else {
    const simulado = {
      ...nuevoRegistro,
      id: Date.now(),
      created_at: new Date().toISOString()
    };
    registrarIdComoPropio(simulado.id);
    agregarOActualizarRegistro(simulado);
    if (!silencioso) mostrarToast('Guardado localmente', 'success');
  }
}

export async function guardarPrecio(e) {
  e.preventDefault();

  const changoEditId = inputChangoEditId?.value.trim() || '';
  const codigo = inputCodigo?.value.trim() || null;
  const comercio = selectComercio?.value;
  const producto = inputProducto?.value.trim();
  const precioTotal = parseFloat(inputPrecio?.value);
  const cantidad = parseFloat(inputCantidad?.value);
  const unidad = selectUnidad?.value;
  const agregarAlChango = Boolean(checkAgregarChango?.checked);
  const actualizarGondola = !agregarAlChango || Boolean(checkActualizarPrecioGondola?.checked);
  const unidadesChango = Math.max(1, parseFloat(inputChangoUnidades?.value) || 1);

  if (!comercio || !producto || isNaN(precioTotal) || precioTotal <= 0 || isNaN(cantidad) || cantidad <= 0) {
    mostrarToast('Completá los campos obligatorios con valores válidos.', 'error');
    return;
  }

  if (!changoEditId && !agregarAlChango && !usuarioActual) {
    mostrarToast('Iniciá sesión para registrar precios.', 'info');
    abrirModalAuth();
    return;
  }

  btnGuardar.disabled = true;

  try {
    if (changoEditId) {
      await actualizarItemChangoCompleto(changoEditId, {
        comercio,
        codigo_barra: codigo,
        producto,
        precio_total: Number(precioTotal.toFixed(2)),
        cantidad_pack: Number(cantidad.toFixed(3)),
        unidad,
        cantidad_chango: unidadesChango,
        actualizarPrecio: actualizarGondola
      });
    } else if (agregarAlChango) {
      await agregarItemAlChango({
        comercio,
        codigo_barra: codigo,
        producto,
        precio_total: Number(precioTotal.toFixed(2)),
        cantidad_pack: Number(cantidad.toFixed(3)),
        unidad,
        cantidad_chango: unidadesChango,
        actualizarPrecio: actualizarGondola
      });
    } else if (actualizarGondola) {
      await registrarPrecioEnBase({
        codigo_barra: codigo,
        comercio,
        producto,
        precio_total: precioTotal,
        cantidad,
        unidad
      });
    }

    // Regla US-04 / CA-05: Conservar el comercio seleccionado
    try {
      localStorage.setItem(LOCAL_STORAGE_COMERCIO, comercio);
    } catch (err) {}

    if (inputChangoEditId) inputChangoEditId.value = '';
    if (inputCodigo) inputCodigo.value = '';
    if (inputProducto) inputProducto.value = '';
    if (inputPrecio) inputPrecio.value = '';
    if (inputCantidad) inputCantidad.value = '1';
    if (inputChangoUnidades) inputChangoUnidades.value = '1';
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

  [tabRecientes, tabComparador, tabComercios, tabChango, tabStock].forEach((tab) => tab?.classList.remove('active'));
  [viewRecientes, viewComparador, viewComercios, viewChango, viewStock].forEach((v) => v?.classList.add('hidden'));

  if (nuevaVista === 'recientes') {
    tabRecientes?.classList.add('active');
    viewRecientes?.classList.remove('hidden');
  } else if (nuevaVista === 'comparador') {
    tabComparador?.classList.add('active');
    viewComparador?.classList.remove('hidden');
  } else if (nuevaVista === 'comercios') {
    tabComercios?.classList.add('active');
    viewComercios?.classList.remove('hidden');
  } else if (nuevaVista === 'chango') {
    tabChango?.classList.add('active');
    viewChango?.classList.remove('hidden');
  } else if (nuevaVista === 'stock') {
    tabStock?.classList.add('active');
    viewStock?.classList.remove('hidden');
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
  } else if (vistaActual === 'chango') {
    renderizarChango();
  } else if (vistaActual === 'stock') {
    renderizarStock();
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
   Vista 4: Mi Chango (Carrito, Control de Gasto y Actualización de Precios)
   ========================================================================== */
function guardarChangoLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_CHANGO, JSON.stringify(listaChango));
  } catch (e) {}
}

function recuperarChangoLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CHANGO);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export async function cargarChangoInicial() {
  listaChango = recuperarChangoLocal();
  try {
    const budgetRaw = localStorage.getItem(LOCAL_STORAGE_CHANGO_BUDGET);
    presupuestoChango = budgetRaw ? parseFloat(budgetRaw) || 0 : 0;
    if (inputChangoPresupuesto && presupuestoChango > 0) {
      inputChangoPresupuesto.value = presupuestoChango;
    }
  } catch (e) {}

  if (vistaActual === 'chango') renderizarChango();

  if (!supabase || !usuarioActual) return;

  try {
    let query = supabase
      .from('chango_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (hogarActual?.id) {
      query = query.eq('hogar_id', hogarActual.id);
    } else {
      query = query.eq('user_id', usuarioActual.id).is('hogar_id', null);
    }

    const { data, error } = await query;

    if (!error && data) {
      listaChango = data;
      guardarChangoLocal();
      if (vistaActual === 'chango') renderizarChango();
    }
  } catch (err) {
    console.warn('Aviso cargando chango desde Supabase (usando caché local):', err);
  }
}

export async function sincronizarPrecioDesdeChango({ codigo_barra, comercio, producto, precio_total, cantidad, unidad }) {
  const prodNorm = producto.trim().toLowerCase();
  const comNorm = comercio.trim().toLowerCase();
  const precioNum = Number(Number(precio_total).toFixed(2));

  const yaExisteIgual = listaPrecios.some((p) =>
    p.producto?.trim().toLowerCase() === prodNorm &&
    p.comercio?.trim().toLowerCase() === comNorm &&
    Number(p.precio_total) === precioNum
  );

  if (yaExisteIgual) return false;

  await registrarPrecioEnBase({
    codigo_barra,
    comercio,
    producto,
    precio_total: precioNum,
    cantidad,
    unidad
  }, true);
  return true;
}

export async function agregarItemAlChango({
  comercio,
  codigo_barra = null,
  producto,
  precio_total,
  cantidad_pack = 1,
  unidad = 'un',
  cantidad_chango = 1,
  actualizarPrecio = true
}) {
  const prodNorm = producto.trim().toLowerCase();
  const comNorm = comercio.trim().toLowerCase();
  const precioNum = Number(Number(precio_total).toFixed(2));

  const existente = listaChango.find((item) =>
    item.producto?.trim().toLowerCase() === prodNorm &&
    item.comercio?.trim().toLowerCase() === comNorm &&
    Number(item.precio_total) === precioNum
  );

  if (existente) {
    await actualizarCantidadChango(existente.id, cantidad_chango);
    if (actualizarPrecio) {
      try {
        await sincronizarPrecioDesdeChango({ codigo_barra, comercio, producto, precio_total: precioNum, cantidad: cantidad_pack, unidad });
      } catch (e) {
        console.warn('No se pudo sincronizar precio:', e);
      }
    }
    return;
  }

  const nuevoItem = {
    comercio,
    codigo_barra: codigo_barra || null,
    producto: producto.trim(),
    precio_total: precioNum,
    cantidad_pack: Number(Number(cantidad_pack).toFixed(3)),
    unidad,
    cantidad_chango: Number(Number(cantidad_chango).toFixed(3)),
    comprado: true,
    hogar_id: hogarActual?.id || null,
    added_by_name: obtenerNombreUsuarioActual()
  };

  if (supabase && usuarioActual) {
    try {
      const { data, error } = await supabase
        .from('chango_items')
        .insert([{ ...nuevoItem, user_id: usuarioActual.id }])
        .select();

      if (error) throw error;
      if (data && data[0]) {
        const yaEnLista = listaChango.some((i) => String(i.id) === String(data[0].id));
        if (!yaEnLista) listaChango.unshift(data[0]);
      }
    } catch (err) {
      console.warn('Guardando ítem de chango localmente:', err);
      listaChango.unshift({ ...nuevoItem, id: 'local-' + Date.now(), created_at: new Date().toISOString() });
    }
  } else {
    listaChango.unshift({ ...nuevoItem, id: 'local-' + Date.now(), created_at: new Date().toISOString() });
  }

  guardarChangoLocal();

  let precioActualizado = false;
  if (actualizarPrecio) {
    try {
      precioActualizado = await sincronizarPrecioDesdeChango({
        codigo_barra,
        comercio,
        producto,
        precio_total: precioNum,
        cantidad: cantidad_pack,
        unidad
      });
    } catch (e) {
      console.warn('No se pudo actualizar precio en Supabase:', e);
    }
  }

  if (vistaActual === 'chango') renderizarChango();
  mostrarToast(
    precioActualizado
      ? `"${producto}" agregado al chango y precio actualizado`
      : `"${producto}" agregado al chango`,
    'success'
  );
}

export async function actualizarCantidadChango(id, delta) {
  const index = listaChango.findIndex((item) => String(item.id) === String(id));
  if (index < 0) return;

  const nuevaCant = Number((Number(listaChango[index].cantidad_chango) + delta).toFixed(3));
  if (nuevaCant <= 0) {
    await eliminarItemChango(id);
    return;
  }

  listaChango[index].cantidad_chango = nuevaCant;
  guardarChangoLocal();
  if (vistaActual === 'chango') renderizarChango();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      await supabase
        .from('chango_items')
        .update({ cantidad_chango: nuevaCant, updated_at: new Date().toISOString() })
        .eq('id', id);
    } catch (e) {
      console.warn('Error actualizando cantidad en Supabase:', e);
    }
  }
}

export function abrirEdicionItemChango(id) {
  const item = listaChango.find((i) => String(i.id) === String(id));
  if (!item) return;

  abrirModalCarga(false, {
    modoChango: true,
    changoEditId: item.id,
    comercio: item.comercio,
    codigo_barra: item.codigo_barra || '',
    producto: item.producto || '',
    precio_total: item.precio_total,
    cantidad: item.cantidad_pack || 1,
    unidad: item.unidad || 'un',
    unidadesChango: item.cantidad_chango || 1
  });
}

export async function actualizarItemChangoCompleto(id, {
  comercio,
  codigo_barra = null,
  producto,
  precio_total,
  cantidad_pack = 1,
  unidad = 'un',
  cantidad_chango = 1,
  actualizarPrecio = true
}) {
  const index = listaChango.findIndex((item) => String(item.id) === String(id));
  if (index < 0) return;

  const cambios = {
    comercio,
    codigo_barra: codigo_barra || null,
    producto: producto.trim(),
    precio_total: Number(Number(precio_total).toFixed(2)),
    cantidad_pack: Number(Number(cantidad_pack).toFixed(3)),
    unidad,
    cantidad_chango: Number(Number(cantidad_chango).toFixed(3)),
    updated_at: new Date().toISOString()
  };

  listaChango[index] = { ...listaChango[index], ...cambios };
  guardarChangoLocal();
  if (vistaActual === 'chango') renderizarChango();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      const { error } = await supabase
        .from('chango_items')
        .update(cambios)
        .eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('Error actualizando ítem de chango en Supabase:', e);
    }
  }

  let precioActualizado = false;
  if (actualizarPrecio) {
    try {
      precioActualizado = await sincronizarPrecioDesdeChango({
        codigo_barra: cambios.codigo_barra,
        comercio: cambios.comercio,
        producto: cambios.producto,
        precio_total: cambios.precio_total,
        cantidad: cambios.cantidad_pack,
        unidad: cambios.unidad
      });
    } catch (e) {
      console.warn('No se pudo sincronizar precio en góndola:', e);
    }
  }

  mostrarToast(
    precioActualizado
      ? `"${cambios.producto}" actualizado en el chango y góndola`
      : `"${cambios.producto}" actualizado en el chango`,
    'success'
  );
}

export async function cambiarComercioTodoElChango(nuevoComercio) {
  const comercioLimpio = nuevoComercio?.trim();
  if (!comercioLimpio) {
    mostrarToast('Seleccioná un comercio válido.', 'error');
    return;
  }
  if (listaChango.length === 0) {
    mostrarToast('Tu chango está vacío.', 'info');
    return;
  }

  const ahora = new Date().toISOString();
  listaChango = listaChango.map((item) => ({
    ...item,
    comercio: comercioLimpio,
    updated_at: ahora
  }));

  guardarChangoLocal();
  try {
    localStorage.setItem(LOCAL_STORAGE_COMERCIO, comercioLimpio);
  } catch (e) {}

  if (changoCambiarComercioBar) changoCambiarComercioBar.classList.add('hidden');
  if (vistaActual === 'chango') renderizarChango();

  if (supabase && usuarioActual) {
    try {
      let query = supabase
        .from('chango_items')
        .update({ comercio: comercioLimpio, updated_at: ahora });

      if (hogarActual?.id) {
        query = query.eq('hogar_id', hogarActual.id);
      } else {
        query = query.eq('user_id', usuarioActual.id).is('hogar_id', null);
      }
      const { error } = await query;
      if (error) throw error;
    } catch (e) {
      console.warn('Error actualizando comercio del chango en Supabase:', e);
    }
  }

  mostrarToast(`Comercio actualizado a "${comercioLimpio}" en todo el chango`, 'success');
}

export async function editarPrecioItemChango(id) {
  abrirEdicionItemChango(id);
}

export async function eliminarItemChango(id) {
  listaChango = listaChango.filter((item) => String(item.id) !== String(id));
  guardarChangoLocal();
  if (vistaActual === 'chango') renderizarChango();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      await supabase.from('chango_items').delete().eq('id', id);
    } catch (e) {
      console.warn('Error eliminando ítem de chango en Supabase:', e);
    }
  }
}

export async function vaciarChango(pedirConfirmacion = true) {
  if (listaChango.length === 0) return;
  if (pedirConfirmacion && !confirm('¿Vaciar todos los productos del chango?')) return;

  listaChango = [];
  guardarChangoLocal();
  if (vistaActual === 'chango') renderizarChango();

  if (supabase && usuarioActual) {
    try {
      if (hogarActual?.id) {
        await supabase.from('chango_items').delete().eq('hogar_id', hogarActual.id);
      } else {
        await supabase.from('chango_items').delete().eq('user_id', usuarioActual.id).is('hogar_id', null);
      }
    } catch (e) {
      console.warn('Error vaciando chango en Supabase:', e);
    }
  }
  if (pedirConfirmacion) mostrarToast('Chango vaciado', 'info');
}

/* ==========================================================================
   Historial de Compras
   ========================================================================== */
function guardarHistorialLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_HISTORIAL, JSON.stringify(listaHistorial));
  } catch (e) {}
}

function recuperarHistorialLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORIAL);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export async function cargarHistorialInicial() {
  listaHistorial = recuperarHistorialLocal();
  if (vistaActual === 'chango') renderizarHistorial();

  if (!supabase || !usuarioActual) return;

  try {
    let query = supabase
      .from('compras_historial')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (hogarActual?.id) {
      query = query.eq('hogar_id', hogarActual.id);
    } else {
      query = query.eq('user_id', usuarioActual.id).is('hogar_id', null);
    }

    const { data, error } = await query;
    if (!error && data) {
      listaHistorial = data;
      guardarHistorialLocal();
      if (vistaActual === 'chango') renderizarHistorial();
    }
  } catch (err) {
    console.warn('Aviso cargando historial desde Supabase (usando caché local):', err);
  }
}

export async function registrarCompraEnHistorial(itemsCompra, totalGastado) {
  const comerciosUnicos = [...new Set(itemsCompra.map((i) => i.comercio).filter(Boolean))];
  const totalItems = itemsCompra.reduce((acc, i) => acc + Number(i.cantidad_chango || 1), 0);

  const snapshotItems = itemsCompra.map((i) => ({
    producto: i.producto,
    comercio: i.comercio,
    codigo_barra: i.codigo_barra || null,
    precio_total: Number(i.precio_total),
    cantidad_pack: Number(i.cantidad_pack || 1),
    unidad: i.unidad || 'un',
    cantidad_chango: Number(i.cantidad_chango || 1),
    subtotal: Number((Number(i.precio_total) * Number(i.cantidad_chango || 1)).toFixed(2))
  }));

  const registro = {
    hogar_id: hogarActual?.id || null,
    added_by_name: obtenerNombreUsuarioActual(),
    comercios: comerciosUnicos,
    total_gastado: Number(totalGastado.toFixed(2)),
    total_items: Number(totalItems.toFixed(3)),
    items: snapshotItems
  };

  if (supabase && usuarioActual) {
    try {
      const { data, error } = await supabase
        .from('compras_historial')
        .insert([{ ...registro, user_id: usuarioActual.id }])
        .select();

      if (error) throw error;
      if (data && data[0]) {
        const yaExiste = listaHistorial.some((h) => String(h.id) === String(data[0].id));
        if (!yaExiste) listaHistorial.unshift(data[0]);
        guardarHistorialLocal();
        if (vistaActual === 'chango') renderizarHistorial();
        return;
      }
    } catch (err) {
      console.warn('Guardando historial localmente:', err);
    }
  }

  listaHistorial.unshift({
    ...registro,
    id: 'local-' + Date.now(),
    created_at: new Date().toISOString()
  });
  guardarHistorialLocal();
  if (vistaActual === 'chango') renderizarHistorial();
}

export async function eliminarCompraHistorial(id) {
  if (!confirm('¿Eliminar esta compra del historial?')) return;

  listaHistorial = listaHistorial.filter((h) => String(h.id) !== String(id));
  guardarHistorialLocal();
  if (vistaActual === 'chango') renderizarHistorial();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      await supabase.from('compras_historial').delete().eq('id', id);
    } catch (e) {
      console.warn('Error eliminando compra del historial en Supabase:', e);
    }
  }
  mostrarToast('Compra eliminada del historial', 'info');
}

export function renderizarHistorial() {
  if (!listaHistorialEl) return;

  if (historialCount) {
    historialCount.textContent = `${listaHistorial.length} ${listaHistorial.length === 1 ? 'compra' : 'compras'}`;
  }

  if (listaHistorial.length === 0) {
    listaHistorialEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <p class="empty-title">Aún no hay compras registradas</p>
        <p class="empty-desc">Cuando presiones "Finalizar Compra", el ticket quedará guardado acá.</p>
      </div>
    `;
    return;
  }

  listaHistorialEl.innerHTML = listaHistorial.map((compra) => {
    const fecha = compra.created_at
      ? new Date(compra.created_at).toLocaleString('es-AR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Recién';
    const totalFmt = Number(compra.total_gastado || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const comercios = Array.isArray(compra.comercios) && compra.comercios.length > 0
      ? compra.comercios
      : ['Sin comercio'];
    const items = Array.isArray(compra.items) ? compra.items : [];

    return `
      <article class="historial-card" data-historial-id="${compra.id}">
        <div class="historial-header">
          <div>
            <div class="historial-date">${escapeHTML(fecha)}</div>
            <div class="price-card-badges">
              ${comercios.map((c) => `<span class="badge-comercio">${escapeHTML(c)}</span>`).join('')}
              ${(hogarActual && compra.added_by_name) ? `<span class="badge-autor">👤 ${escapeHTML(compra.added_by_name)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span class="historial-total">$${totalFmt}</span>
            <button type="button" class="btn-delete-item btn-historial-del" data-id="${compra.id}" title="Eliminar del historial">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        <details class="historial-details">
          <summary>Ver ${items.length} ${items.length === 1 ? 'producto' : 'productos'} (${compra.total_items || items.length} u.)</summary>
          <div class="historial-items-list">
            ${items.map((it) => {
              const subFmt = Number(it.subtotal ?? (Number(it.precio_total) * Number(it.cantidad_chango || 1))).toLocaleString('es-AR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
              return `
                <div class="historial-item-row">
                  <span>${escapeHTML(it.producto)} <span class="historial-item-sub">× ${it.cantidad_chango || 1} (${escapeHTML(it.comercio || '')})</span></span>
                  <strong>$${subFmt}</strong>
                </div>
              `;
            }).join('')}
          </div>
        </details>
      </article>
    `;
  }).join('');

  listaHistorialEl.querySelectorAll('.btn-historial-del').forEach((btn) => {
    btn.addEventListener('click', () => eliminarCompraHistorial(btn.getAttribute('data-id')));
  });
}

export async function finalizarCompraChango() {
  if (listaChango.length === 0) {
    mostrarToast('Tu chango está vacío.', 'info');
    return;
  }

  const totalGastado = listaChango.reduce((acc, item) => acc + (Number(item.precio_total) * Number(item.cantidad_chango)), 0);
  const totalFmt = totalGastado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pasarAStock = confirm(
    `Total de la compra: $${totalFmt}\n\n¿Querés guardar el ticket en el Historial, sumar estos ${listaChango.length} productos a tu Stock en Casa y vaciar el chango?`
  );

  if (!pasarAStock) return;

  const itemsSnapshot = [...listaChango];
  await registrarCompraEnHistorial(itemsSnapshot, totalGastado);

  for (const item of itemsSnapshot) {
    const sumaCantidad = item.unidad === 'un'
      ? Number(item.cantidad_chango)
      : Number((Number(item.cantidad_chango) * Number(item.cantidad_pack || 1)).toFixed(3));

    await sumarOActualizarEnStock({
      codigo_barra: item.codigo_barra,
      producto: item.producto,
      cantidad: sumaCantidad,
      unidad: item.unidad || 'un'
    });
  }

  await vaciarChango(false);
  mostrarToast(`¡Compra finalizada ($${totalFmt})! Guardada en Historial y Stock Casa.`, 'success');
}

export function renderizarChango() {
  if (!contenedorChango) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';
  const filtrados = listaChango.filter((item) => {
    if (!termino) return true;
    return (
      item.producto?.toLowerCase().includes(termino) ||
      item.comercio?.toLowerCase().includes(termino) ||
      item.codigo_barra?.toLowerCase().includes(termino)
    );
  });

  const totalGasto = listaChango.reduce(
    (acc, item) => acc + (Number(item.precio_total) * Number(item.cantidad_chango)),
    0
  );
  const totalUnidades = listaChango.reduce((acc, item) => acc + Number(item.cantidad_chango), 0);

  if (changoTotalGasto) {
    changoTotalGasto.textContent = `$${totalGasto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (changoItemsCount) {
    changoItemsCount.textContent = `${listaChango.length} ${listaChango.length === 1 ? 'ítem' : 'ítems'}`;
  }
  if (changoUnitsCount) {
    changoUnitsCount.textContent = `${totalUnidades} ${totalUnidades === 1 ? 'unidad' : 'unidades'}`;
  }

  // Barra de presupuesto
  if (changoBudgetProgressWrap && changoBudgetBar && changoBudgetText) {
    if (presupuestoChango > 0) {
      changoBudgetProgressWrap.classList.remove('hidden');
      const pct = Math.min(100, Math.round((totalGasto / presupuestoChango) * 100));
      const restante = presupuestoChango - totalGasto;

      changoBudgetBar.style.width = `${pct}%`;
      changoBudgetBar.classList.remove('warning', 'danger');
      if (totalGasto > presupuestoChango) {
        changoBudgetBar.classList.add('danger');
        const excesoFmt = Math.abs(restante).toLocaleString('es-AR', { minimumFractionDigits: 2 });
        changoBudgetText.textContent = `Excedido por $${excesoFmt} (${Math.round((totalGasto / presupuestoChango) * 100)}%)`;
      } else {
        if (pct >= 80) changoBudgetBar.classList.add('warning');
        const restFmt = restante.toLocaleString('es-AR', { minimumFractionDigits: 2 });
        changoBudgetText.textContent = `${pct}% usado · Quedan $${restFmt}`;
      }
    } else {
      changoBudgetProgressWrap.classList.add('hidden');
    }
  }

  if (filtrados.length === 0) {
    contenedorChango.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <p class="empty-title">${termino ? 'Sin coincidencias en tu chango' : 'Tu chango está vacío'}</p>
        <p class="empty-desc">Tocá "+ Agregar al Chango" para escanear o cargar lo que vas poniendo en el carrito.</p>
      </div>
    `;
    renderizarHistorial();
    return;
  }

  contenedorChango.innerHTML = filtrados.map((item) => {
    const subtotal = Number(item.precio_total) * Number(item.cantidad_chango);
    const subtotalFmt = subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const unitFmt = Number(item.precio_total).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `
      <article class="chango-item-card" data-chango-id="${item.id}">
        <div class="chango-item-top">
          <div>
            <h3 class="chango-item-title">${escapeHTML(item.producto)}</h3>
            <div class="price-card-badges">
              <span class="badge-comercio">${escapeHTML(item.comercio)}</span>
              ${item.codigo_barra ? `<span class="badge-codigo">#${escapeHTML(item.codigo_barra)}</span>` : ''}
              ${(hogarActual && item.added_by_name) ? `<span class="badge-autor">👤 ${escapeHTML(item.added_by_name)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn-delete-item btn-chango-del" data-id="${item.id}" title="Quitar del chango">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>

        <div class="chango-item-bottom">
          <div class="chango-price-edit-wrap">
            <span class="chango-subtotal">$${subtotalFmt}</span>
            <span class="chango-unit-detail">$${unitFmt} c/u (${item.cantidad_pack || 1} ${item.unidad || 'un'})</span>
          </div>

          <div class="stock-card-actions">
            <button type="button" class="btn-inline-edit btn-chango-edit-item" data-id="${item.id}" title="Editar producto, comercio o precio">
              ✏️ Editar
            </button>
            <div class="stepper-control">
              <button type="button" class="stepper-btn btn-chango-dec" data-id="${item.id}" aria-label="Restar unidad">−</button>
              <span class="stepper-val">${item.cantidad_chango}</span>
              <button type="button" class="stepper-btn btn-chango-inc" data-id="${item.id}" aria-label="Sumar unidad">+</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  contenedorChango.querySelectorAll('.btn-chango-inc').forEach((btn) => {
    btn.addEventListener('click', () => actualizarCantidadChango(btn.getAttribute('data-id'), 1));
  });
  contenedorChango.querySelectorAll('.btn-chango-dec').forEach((btn) => {
    btn.addEventListener('click', () => actualizarCantidadChango(btn.getAttribute('data-id'), -1));
  });
  contenedorChango.querySelectorAll('.btn-chango-del').forEach((btn) => {
    btn.addEventListener('click', () => eliminarItemChango(btn.getAttribute('data-id')));
  });
  contenedorChango.querySelectorAll('.btn-chango-edit-item').forEach((btn) => {
    btn.addEventListener('click', () => abrirEdicionItemChango(btn.getAttribute('data-id')));
  });

  renderizarHistorial();
}

/* ==========================================================================
   Vista 5: Stock Casa (Inventario del Hogar)
   ========================================================================== */
function guardarStockLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_STOCK, JSON.stringify(listaStock));
  } catch (e) {}
}

function recuperarStockLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_STOCK);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export async function cargarStockInicial() {
  listaStock = recuperarStockLocal();
  if (vistaActual === 'stock') renderizarStock();

  if (!supabase || !usuarioActual) return;

  try {
    let query = supabase
      .from('stock_casa')
      .select('*')
      .order('producto', { ascending: true });

    if (hogarActual?.id) {
      query = query.eq('hogar_id', hogarActual.id);
    } else {
      query = query.eq('user_id', usuarioActual.id).is('hogar_id', null);
    }

    const { data, error } = await query;

    if (!error && data) {
      listaStock = data;
      guardarStockLocal();
      if (vistaActual === 'stock') renderizarStock();
    }
  } catch (err) {
    console.warn('Aviso cargando stock desde Supabase (usando caché local):', err);
  }
}

export async function sumarOActualizarEnStock({ codigo_barra = null, producto, cantidad, unidad = 'un', categoria = 'General' }) {
  const prodNorm = producto.trim().toLowerCase();
  const existente = listaStock.find((s) =>
    (codigo_barra && s.codigo_barra && s.codigo_barra === codigo_barra) ||
    s.producto?.trim().toLowerCase() === prodNorm
  );

  if (existente) {
    const nuevaCant = Number((Number(existente.cantidad) + Number(cantidad)).toFixed(3));
    existente.cantidad = nuevaCant;
    if (categoria && categoria !== 'General' && (!existente.categoria || existente.categoria === 'General')) {
      existente.categoria = categoria;
    }
    guardarStockLocal();
    if (supabase && usuarioActual && !String(existente.id).startsWith('local-')) {
      try {
        await supabase
          .from('stock_casa')
          .update({
            cantidad: nuevaCant,
            categoria: existente.categoria || categoria || 'General',
            updated_at: new Date().toISOString()
          })
          .eq('id', existente.id);
      } catch (e) {}
    }
    return;
  }

  const nuevoStock = {
    codigo_barra,
    producto: producto.trim(),
    cantidad: Number(Number(cantidad).toFixed(3)),
    unidad,
    stock_minimo: 1,
    categoria: categoria || 'General',
    hogar_id: hogarActual?.id || null,
    added_by_name: obtenerNombreUsuarioActual()
  };

  if (supabase && usuarioActual) {
    try {
      const { data, error } = await supabase
        .from('stock_casa')
        .insert([{ ...nuevoStock, user_id: usuarioActual.id }])
        .select();
      if (!error && data && data[0]) {
        const yaEnLista = listaStock.some((s) => String(s.id) === String(data[0].id));
        if (!yaEnLista) listaStock.push(data[0]);
        guardarStockLocal();
        return;
      }
    } catch (e) {}
  }

  listaStock.push({ ...nuevoStock, id: 'local-' + Date.now(), created_at: new Date().toISOString() });
  guardarStockLocal();
}

export function abrirModalStock(itemEditar = null) {
  if (!modalStockBackdrop) return;

  if (itemEditar) {
    if (modalStockTitle) modalStockTitle.textContent = 'Editar Producto en Stock';
    if (inputStockId) inputStockId.value = itemEditar.id || '';
    if (inputStockCodigo) inputStockCodigo.value = itemEditar.codigo_barra || '';
    if (inputStockProducto) inputStockProducto.value = itemEditar.producto || '';
    if (inputStockCantidad) inputStockCantidad.value = itemEditar.cantidad ?? 1;
    if (selectStockUnidad) selectStockUnidad.value = itemEditar.unidad || 'un';
    if (inputStockMinimo) inputStockMinimo.value = itemEditar.stock_minimo ?? 1;
    if (selectStockCategoria) selectStockCategoria.value = itemEditar.categoria || 'General';
  } else {
    if (modalStockTitle) modalStockTitle.textContent = 'Agregar al Stock';
    formStock?.reset();
    if (inputStockId) inputStockId.value = '';
    if (inputStockCantidad) inputStockCantidad.value = '1';
    if (inputStockMinimo) inputStockMinimo.value = '1';
    if (selectStockCategoria) selectStockCategoria.value = 'General';
  }

  modalStockBackdrop.classList.remove('hidden');
  setTimeout(() => inputStockProducto?.focus(), 150);
}

export async function cerrarModalStock() {
  if (escanerStockActivo) {
    await detenerEscanerStock();
  }
  modalStockBackdrop?.classList.add('hidden');
  formStock?.reset();
}

export async function iniciarEscanerStock() {
  if (escanerStockActivo) return;
  if (typeof Html5Qrcode === 'undefined') {
    mostrarToast('Librería de escaneo no disponible.', 'error');
    return;
  }

  try {
    stockScannerSection?.classList.remove('hidden');
    if (btnScanStockText) btnScanStockText.textContent = 'Cerrar visor';
    escanerStockActivo = true;

    if (!html5QrCodeStock) {
      html5QrCodeStock = new Html5Qrcode('reader-stock');
    }

    const config = { fps: 10, qrbox: { width: 240, height: 150 }, aspectRatio: 1.0 };
    const onSuccess = async (decodedText) => {
      ejecutarFeedbackHaptico();
      if (inputStockCodigo) inputStockCodigo.value = decodedText;
      const match = listaPrecios.find((p) => p.codigo_barra === decodedText);
      if (match && inputStockProducto && !inputStockProducto.value) {
        inputStockProducto.value = match.producto;
        if (selectStockUnidad && match.unidad) selectStockUnidad.value = match.unidad;
      }
      mostrarToast(`Código detectado: ${decodedText}`, 'success');
      await detenerEscanerStock();
      inputStockProducto?.focus();
    };

    try {
      await html5QrCodeStock.start({ facingMode: 'environment' }, config, onSuccess, () => {});
    } catch {
      await html5QrCodeStock.start({ facingMode: 'user' }, config, onSuccess, () => {});
    }
  } catch (err) {
    mostrarToast('No se pudo abrir la cámara.', 'error');
    await detenerEscanerStock();
  }
}

export async function detenerEscanerStock() {
  if (html5QrCodeStock) {
    try {
      if (html5QrCodeStock.isScanning) await html5QrCodeStock.stop();
      html5QrCodeStock.clear();
    } catch (e) {}
  }
  stockScannerSection?.classList.add('hidden');
  if (btnScanStockText) btnScanStockText.textContent = 'Escanear';
  escanerStockActivo = false;
}

export async function guardarItemStock(e) {
  e.preventDefault();

  const id = inputStockId?.value.trim();
  const codigo_barra = inputStockCodigo?.value.trim() || null;
  const producto = inputStockProducto?.value.trim();
  const cantidad = parseFloat(inputStockCantidad?.value);
  const unidad = selectStockUnidad?.value || 'un';
  const stock_minimo = parseFloat(inputStockMinimo?.value) || 0;
  const categoria = selectStockCategoria?.value || 'General';

  if (!producto || isNaN(cantidad) || cantidad < 0) {
    mostrarToast('Ingresá un nombre de producto y una cantidad válida.', 'error');
    return;
  }

  const datos = {
    codigo_barra,
    producto,
    cantidad: Number(cantidad.toFixed(3)),
    unidad,
    stock_minimo: Number(stock_minimo.toFixed(3)),
    categoria,
    hogar_id: hogarActual?.id || null,
    added_by_name: obtenerNombreUsuarioActual(),
    updated_at: new Date().toISOString()
  };

  try {
    if (supabase && usuarioActual) {
      if (id && !id.startsWith('local-')) {
        const { error } = await supabase.from('stock_casa').update(datos).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('stock_casa')
          .insert([{ ...datos, user_id: usuarioActual.id }])
          .select();
        if (error) throw error;
        if (data && data[0]) datos.id = data[0].id;
      }
    }

    const idx = listaStock.findIndex((s) => (id && String(s.id) === String(id)));
    if (idx >= 0) {
      listaStock[idx] = { ...listaStock[idx], ...datos };
    } else {
      listaStock.push({ id: datos.id || 'local-' + Date.now(), ...datos });
    }

    guardarStockLocal();
    await cerrarModalStock();
    if (vistaActual === 'stock') renderizarStock();
    mostrarToast(`"${producto}" guardado en tu stock`, 'success');
  } catch (err) {
    console.warn('Error guardando stock en Supabase (guardado local):', err);
    const idx = listaStock.findIndex((s) => (id && String(s.id) === String(id)));
    if (idx >= 0) {
      listaStock[idx] = { ...listaStock[idx], ...datos };
    } else {
      listaStock.push({ id: 'local-' + Date.now(), ...datos });
    }
    guardarStockLocal();
    await cerrarModalStock();
    if (vistaActual === 'stock') renderizarStock();
    mostrarToast(`"${producto}" guardado localmente`, 'success');
  }
}

export async function ajustarCantidadStock(id, delta) {
  const item = listaStock.find((s) => String(s.id) === String(id));
  if (!item) return;

  const nuevaCant = Math.max(0, Number((Number(item.cantidad) + delta).toFixed(3)));
  item.cantidad = nuevaCant;
  guardarStockLocal();
  if (vistaActual === 'stock') renderizarStock();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      await supabase
        .from('stock_casa')
        .update({ cantidad: nuevaCant, updated_at: new Date().toISOString() })
        .eq('id', id);
    } catch (e) {}
  }
}

export async function eliminarItemStock(id) {
  if (!confirm('¿Eliminar este producto de tu Stock en Casa?')) return;
  listaStock = listaStock.filter((s) => String(s.id) !== String(id));
  guardarStockLocal();
  if (vistaActual === 'stock') renderizarStock();

  if (supabase && usuarioActual && !String(id).startsWith('local-')) {
    try {
      await supabase.from('stock_casa').delete().eq('id', id);
    } catch (e) {}
  }
  mostrarToast('Producto eliminado del stock', 'info');
}

export function enviarStockAChango(id) {
  const item = listaStock.find((s) => String(s.id) === String(id));
  if (!item) return;

  const precioConocido = listaPrecios.find((p) =>
    (item.codigo_barra && p.codigo_barra === item.codigo_barra) ||
    p.producto?.trim().toLowerCase() === item.producto?.trim().toLowerCase()
  );

  abrirModalCarga(false, {
    modoChango: true,
    codigo_barra: item.codigo_barra || '',
    producto: item.producto,
    precio_total: precioConocido?.precio_total || '',
    cantidad: precioConocido?.cantidad || 1,
    unidad: item.unidad || precioConocido?.unidad || 'un',
    unidadesChango: 1
  });
}

export function renderizarStock() {
  if (!contenedorStock) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';
  const totalCount = listaStock.length;
  const bajosCount = listaStock.filter((s) => Number(s.cantidad) <= Number(s.stock_minimo)).length;

  if (stockTotalCount) stockTotalCount.textContent = totalCount;
  if (stockBajoCount) stockBajoCount.textContent = bajosCount;

  const filtrados = listaStock
    .filter((item) => {
      if (filtroStock === 'bajo' && Number(item.cantidad) > Number(item.stock_minimo)) {
        return false;
      }
      if (!termino) return true;
      return (
        item.producto?.toLowerCase().includes(termino) ||
        item.categoria?.toLowerCase().includes(termino) ||
        item.codigo_barra?.toLowerCase().includes(termino)
      );
    })
    .sort((a, b) => a.producto.localeCompare(b.producto));

  if (stockVisibleCount) {
    stockVisibleCount.textContent = `${filtrados.length} ${filtrados.length === 1 ? 'producto' : 'productos'}`;
  }

  if (filtrados.length === 0) {
    contenedorStock.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${filtroStock === 'bajo' ? '✅' : '🏠'}</div>
        <p class="empty-title">${filtroStock === 'bajo' ? '¡Todo con buen stock!' : 'Sin productos en Stock Casa'}</p>
        <p class="empty-desc">${filtroStock === 'bajo' ? 'No tenés productos por debajo del mínimo.' : 'Tocá "+ Agregar" para registrar lo que tenés en tu alacena o heladera.'}</p>
      </div>
    `;
    return;
  }

  contenedorStock.innerHTML = filtrados.map((item) => {
    const cant = Number(item.cantidad);
    const min = Number(item.stock_minimo);
    const sinStock = cant <= 0;
    const stockBajo = !sinStock && cant <= min;

    return `
      <article class="stock-card ${sinStock ? 'out-stock' : stockBajo ? 'low-stock' : ''}" data-stock-id="${item.id}">
        <div class="stock-card-top">
          <div>
            <h3 class="stock-card-title">${escapeHTML(item.producto)}</h3>
            <div class="price-card-badges">
              <span class="badge-categoria">${escapeHTML(item.categoria || 'General')}</span>
              ${sinStock ? '<span class="badge-out-stock">❌ Sin stock</span>' : ''}
              ${stockBajo ? '<span class="badge-low-stock">⚠️ Stock bajo</span>' : ''}
              ${item.codigo_barra ? `<span class="badge-codigo">#${escapeHTML(item.codigo_barra)}</span>` : ''}
            </div>
          </div>
          <div class="stock-card-actions">
            <button type="button" class="btn-inline-edit btn-stock-edit" data-id="${item.id}" title="Editar producto">✏️</button>
            <button type="button" class="btn-delete-item btn-stock-del" data-id="${item.id}" title="Eliminar del stock">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="stock-card-bottom">
          <div class="stepper-control">
            <button type="button" class="stepper-btn btn-stock-dec" data-id="${item.id}" aria-label="Descontar">−</button>
            <span class="stepper-val">${cant} ${escapeHTML(item.unidad)}</span>
            <button type="button" class="stepper-btn btn-stock-inc" data-id="${item.id}" aria-label="Sumar">+</button>
          </div>

          <button type="button" class="btn-stock-to-chango" data-id="${item.id}" title="Mandar al chango de compras">
            🛒 Al Chango
          </button>
        </div>
      </article>
    `;
  }).join('');

  contenedorStock.querySelectorAll('.btn-stock-inc').forEach((btn) => {
    btn.addEventListener('click', () => ajustarCantidadStock(btn.getAttribute('data-id'), 1));
  });
  contenedorStock.querySelectorAll('.btn-stock-dec').forEach((btn) => {
    btn.addEventListener('click', () => ajustarCantidadStock(btn.getAttribute('data-id'), -1));
  });
  contenedorStock.querySelectorAll('.btn-stock-del').forEach((btn) => {
    btn.addEventListener('click', () => eliminarItemStock(btn.getAttribute('data-id')));
  });
  contenedorStock.querySelectorAll('.btn-stock-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const found = listaStock.find((s) => String(s.id) === String(id));
      if (found) abrirModalStock(found);
    });
  });
  contenedorStock.querySelectorAll('.btn-stock-to-chango').forEach((btn) => {
    btn.addEventListener('click', () => enviarStockAChango(btn.getAttribute('data-id')));
  });
}

/* ==========================================================================
   Hogar Compartido (Modo Colaborativo Privado y Realtime)
   ========================================================================== */
export function obtenerNombreUsuarioActual() {
  if (!usuarioActual) return 'Invitado';
  const meta = usuarioActual.user_metadata || {};
  return meta.full_name || meta.name || usuarioActual.email?.split('@')[0] || 'Usuario';
}

export function actualizarUIHogar() {
  const textoPill = hogarActual
    ? `👥 ${hogarActual.nombre} (${Math.max(1, miembrosHogar.length)})`
    : '👤 Modo personal';
  const textoBtn = hogarActual ? '⚙️ Gestionar' : '👥 Compartir / Unirse';

  [hogarPillChango, hogarPillStock].forEach((el) => {
    if (!el) return;
    el.textContent = textoPill;
    el.classList.toggle('shared', Boolean(hogarActual));
  });

  [btnHogarChango, btnHogarStock].forEach((btn) => {
    if (btn) btn.textContent = textoBtn;
  });

  if (hogarActual) {
    hogarSinGrupo?.classList.add('hidden');
    hogarActivoEl?.classList.remove('hidden');
    if (hogarActivoNombre) hogarActivoNombre.textContent = hogarActual.nombre;
    if (hogarActivoCodigo) hogarActivoCodigo.textContent = hogarActual.codigo_invitacion;
    if (hogarMiembrosCount) {
      const n = Math.max(1, miembrosHogar.length);
      hogarMiembrosCount.textContent = `${n} ${n === 1 ? 'miembro' : 'miembros'}`;
    }

    const soyCreador = usuarioActual && hogarActual.created_by === usuarioActual.id;
    btnHogarRegenerar?.classList.toggle('hidden', !soyCreador);

    if (listaHogarMiembros) {
      listaHogarMiembros.innerHTML = miembrosHogar.map((m) => `
        <div class="hogar-member-row">
          <span>👤 ${escapeHTML(m.display_name || 'Miembro')}</span>
          <span class="badge-categoria">${m.rol === 'owner' ? 'Creador' : 'Miembro'}</span>
        </div>
      `).join('');
    }
  } else {
    hogarSinGrupo?.classList.remove('hidden');
    hogarActivoEl?.classList.add('hidden');
  }
}

export function abrirModalHogar() {
  if (!usuarioActual) {
    mostrarToast('Iniciá sesión para compartir tu Chango y Stock Casa.', 'info');
    abrirModalAuth();
    return;
  }
  actualizarUIHogar();
  modalHogarBackdrop?.classList.remove('hidden');
}

export function cerrarModalHogar() {
  modalHogarBackdrop?.classList.add('hidden');
}

export async function cargarHogarInicial() {
  if (!supabase || !usuarioActual) {
    hogarActual = null;
    miembrosHogar = [];
    actualizarUIHogar();
    return;
  }

  try {
    const { data, error } = await supabase
      .from('hogar_miembros')
      .select('rol, display_name, hogares(*)')
      .eq('user_id', usuarioActual.id)
      .limit(1);

    if (!error && data && data.length > 0 && data[0].hogares) {
      hogarActual = data[0].hogares;
      try {
        localStorage.setItem(LOCAL_STORAGE_HOGAR, JSON.stringify(hogarActual));
      } catch (e) {}

      const { data: miembros } = await supabase
        .from('hogar_miembros')
        .select('user_id, display_name, rol')
        .eq('hogar_id', hogarActual.id);
      miembrosHogar = miembros || [];
    } else {
      hogarActual = null;
      miembrosHogar = [];
      try {
        localStorage.removeItem(LOCAL_STORAGE_HOGAR);
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Aviso cargando hogar:', err);
  }

  actualizarUIHogar();
}

export async function procesarInvitacionPendiente() {
  if (!supabase || !usuarioActual) return;
  let codigo = null;
  try {
    codigo = sessionStorage.getItem('changocheck_pending_hogar');
  } catch (e) {}
  if (!codigo) return;

  try {
    sessionStorage.removeItem('changocheck_pending_hogar');
  } catch (e) {}
  await unirseAHogarPorCodigo(codigo);
}

export async function crearHogar(e) {
  e.preventDefault();
  const nombre = inputHogarNombre?.value.trim();
  if (!nombre || nombre.length < 2) {
    mostrarToast('Ingresá un nombre válido para tu hogar.', 'error');
    return;
  }

  try {
    const { data, error } = await supabase.rpc('crear_hogar', {
      p_nombre: nombre,
      p_display_name: obtenerNombreUsuarioActual()
    });
    if (error) throw error;

    hogarActual = data;
    if (inputHogarNombre) inputHogarNombre.value = '';
    await cargarHogarInicial();
    await cargarChangoInicial();
    await cargarHistorialInicial();
    await cargarStockInicial();
    suscribirRealtimeHogar();
    mostrarToast(`Hogar "${hogarActual.nombre}" creado. Código: ${hogarActual.codigo_invitacion}`, 'success');
  } catch (err) {
    console.error('Error creando hogar:', err);
    mostrarToast(`Error: ${err.message || 'No se pudo crear el hogar'}`, 'error');
  }
}

export async function unirseAHogarPorCodigo(codigo) {
  const limpio = codigo?.trim().toUpperCase();
  if (!limpio) {
    mostrarToast('Ingresá un código de invitación.', 'error');
    return;
  }

  try {
    const { data, error } = await supabase.rpc('unirse_a_hogar', {
      p_codigo: limpio,
      p_display_name: obtenerNombreUsuarioActual()
    });
    if (error) throw error;

    hogarActual = data;
    if (inputHogarCodigo) inputHogarCodigo.value = '';
    await cargarHogarInicial();
    await cargarChangoInicial();
    await cargarHistorialInicial();
    await cargarStockInicial();
    suscribirRealtimeHogar();
    mostrarToast(`¡Te uniste al hogar "${hogarActual.nombre}"!`, 'success');
  } catch (err) {
    console.error('Error uniéndose al hogar:', err);
    mostrarToast(err.message || 'Código inválido o expirado', 'error');
  }
}

export async function regenerarCodigoHogar() {
  if (!hogarActual?.id) return;
  if (!confirm('¿Generar un nuevo código? El código anterior dejará de funcionar.')) return;

  try {
    const { data, error } = await supabase.rpc('regenerar_codigo_hogar', {
      p_hogar_id: hogarActual.id
    });
    if (error) throw error;

    hogarActual.codigo_invitacion = data;
    actualizarUIHogar();
    mostrarToast(`Nuevo código generado: ${data}`, 'success');
  } catch (err) {
    mostrarToast(err.message || 'No se pudo regenerar el código', 'error');
  }
}

export async function salirDelHogar() {
  if (!hogarActual?.id || !usuarioActual) return;
  if (!confirm(`¿Salir del hogar "${hogarActual.nombre}"? Volverás a tu modo personal.`)) return;

  try {
    const { error } = await supabase
      .from('hogar_miembros')
      .delete()
      .eq('hogar_id', hogarActual.id)
      .eq('user_id', usuarioActual.id);

    if (error) throw error;

    hogarActual = null;
    miembrosHogar = [];
    actualizarUIHogar();
    await cargarChangoInicial();
    await cargarHistorialInicial();
    await cargarStockInicial();
    suscribirRealtimeHogar();
    cerrarModalHogar();
    mostrarToast('Saliste del hogar compartido.', 'info');
  } catch (err) {
    mostrarToast(err.message || 'No se pudo salir del hogar', 'error');
  }
}

export function suscribirRealtimeHogar() {
  if (!supabase) return;

  if (realtimeChannelChango) {
    supabase.removeChannel(realtimeChannelChango);
    realtimeChannelChango = null;
  }
  if (realtimeChannelHistorial) {
    supabase.removeChannel(realtimeChannelHistorial);
    realtimeChannelHistorial = null;
  }
  if (realtimeChannelStock) {
    supabase.removeChannel(realtimeChannelStock);
    realtimeChannelStock = null;
  }

  if (!usuarioActual) return;

  const filtro = hogarActual?.id
    ? `hogar_id=eq.${hogarActual.id}`
    : `user_id=eq.${usuarioActual.id}`;

  realtimeChannelChango = supabase
    .channel(`chango:${hogarActual?.id || usuarioActual.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chango_items', filter: filtro },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const existe = listaChango.some((i) => String(i.id) === String(payload.new.id));
          if (!existe) {
            listaChango.unshift(payload.new);
            guardarChangoLocal();
            if (vistaActual === 'chango') renderizarChango();
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = listaChango.findIndex((i) => String(i.id) === String(payload.new.id));
          if (idx >= 0) {
            listaChango[idx] = payload.new;
            guardarChangoLocal();
            if (vistaActual === 'chango') renderizarChango();
          }
        } else if (payload.eventType === 'DELETE') {
          listaChango = listaChango.filter((i) => String(i.id) !== String(payload.old.id));
          guardarChangoLocal();
          if (vistaActual === 'chango') renderizarChango();
        }
      }
    )
    .subscribe();

  realtimeChannelHistorial = supabase
    .channel(`historial:${hogarActual?.id || usuarioActual.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'compras_historial', filter: filtro },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const existe = listaHistorial.some((h) => String(h.id) === String(payload.new.id));
          if (!existe) {
            listaHistorial.unshift(payload.new);
            guardarHistorialLocal();
            if (vistaActual === 'chango') renderizarHistorial();
          }
        } else if (payload.eventType === 'DELETE') {
          listaHistorial = listaHistorial.filter((h) => String(h.id) !== String(payload.old.id));
          guardarHistorialLocal();
          if (vistaActual === 'chango') renderizarHistorial();
        }
      }
    )
    .subscribe();

  realtimeChannelStock = supabase
    .channel(`stock:${hogarActual?.id || usuarioActual.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stock_casa', filter: filtro },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const existe = listaStock.some((s) => String(s.id) === String(payload.new.id));
          if (!existe) {
            listaStock.push(payload.new);
            guardarStockLocal();
            if (vistaActual === 'stock') renderizarStock();
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = listaStock.findIndex((s) => String(s.id) === String(payload.new.id));
          if (idx >= 0) {
            listaStock[idx] = payload.new;
            guardarStockLocal();
            if (vistaActual === 'stock') renderizarStock();
          }
        } else if (payload.eventType === 'DELETE') {
          listaStock = listaStock.filter((s) => String(s.id) !== String(payload.old.id));
          guardarStockLocal();
          if (vistaActual === 'stock') renderizarStock();
        }
      }
    )
    .subscribe();
}

/* ==========================================================================
   Importador Automático de Tickets PDF / Fotos y Recuperación de Ticket
   ========================================================================== */
const modalTicketBackdrop = document.getElementById('modal-ticket-backdrop');
const btnCerrarModalTicket = document.getElementById('btn-cerrar-modal-ticket');
const btnCancelarTicket = document.getElementById('btn-cancelar-ticket');
const btnImportarTicketChango = document.getElementById('btn-importar-ticket-chango');
const btnImportarTicketStock = document.getElementById('btn-importar-ticket-stock');
const btnCargarTicketCarrefourPrecargado = document.getElementById('btn-cargar-ticket-carrefour-precargado');
const btnSeleccionarArchivoTicket = document.getElementById('btn-seleccionar-archivo-ticket');
const inputTicketFile = document.getElementById('input-ticket-file');
const ticketUploadStatus = document.getElementById('ticket-upload-status');
const textareaTicketRaw = document.getElementById('textarea-ticket-raw');
const btnParsearTextoTicket = document.getElementById('btn-parsear-texto-ticket');
const ticketPreviewWrap = document.getElementById('ticket-preview-wrap');
const inputTicketComercio = document.getElementById('input-ticket-comercio');
const ticketPreviewTotal = document.getElementById('ticket-preview-total');
const ticketPreviewMeta = document.getElementById('ticket-preview-meta');
const ticketItemsPreviewList = document.getElementById('ticket-items-preview-list');
const chkTicketHistorial = document.getElementById('chk-ticket-historial');
const chkTicketStock = document.getElementById('chk-ticket-stock');
const chkTicketPrecios = document.getElementById('chk-ticket-precios');
const chkTicketChango = document.getElementById('chk-ticket-chango');
const btnConfirmarImportarTicket = document.getElementById('btn-confirmar-importar-ticket');

let ticketParseadoActual = null;

// Ticket Carrefour Adrogué 16/11/2026 (Factura B Nro T. 00162830 - $121.381,20) pre-procesado
export const TICKET_CARREFOUR_16_11_2026 = {
  comercio: 'Carrefour',
  fecha: '16/11/2026 21:51',
  nroTicket: '00162830',
  ahorroTotal: 13913.45,
  totalNeto: 121381.20,
  items: [
    { codigo_barra: '7790742348302', producto: 'Leche Ent 3% Bienestar La Serenísima Sac 1L', cantidad_chango: 2, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'l', precio_lista: 2225.00, descuento: 652.00, precio_unitario_neto: 1899.00, subtotal: 3798.00, categoria: 'Heladera', seleccionado: true },
    { codigo_barra: '7798001562605', producto: 'Leche Descremada Larga Vida Cremigal Sac 1L', cantidad_chango: 2, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'l', precio_lista: 1690.00, descuento: 0, precio_unitario_neto: 1690.00, subtotal: 3380.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791620187662', producto: 'Mayonesa Dánica Doypack x 500 grs', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 500, unidad_pack: 'g', precio_lista: 2159.00, descuento: 0, precio_unitario_neto: 2159.00, subtotal: 2159.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7613287149145', producto: 'Cacao en Polvo Nescao x 300 grs', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 300, unidad_pack: 'g', precio_lista: 4399.00, descuento: 0, precio_unitario_neto: 4399.00, subtotal: 4399.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791720017296', producto: 'Mermelada de Frutilla Light Carrefour', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 390, unidad_pack: 'g', precio_lista: 3490.00, descuento: 240.00, precio_unitario_neto: 3250.00, subtotal: 3250.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7798083732378', producto: 'Mermelada Arándanos Carrefour Classic', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 454, unidad_pack: 'g', precio_lista: 3490.00, descuento: 240.00, precio_unitario_neto: 3250.00, subtotal: 3250.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7798141714827', producto: 'Rebozador Carrefour Bolsa x 1 kg', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 2750.00, descuento: 200.00, precio_unitario_neto: 2550.00, subtotal: 2550.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791720027721', producto: 'Tomate Perita Cubeteados Carrefour x 400 grs', cantidad_chango: 4, unidad_stock: 'un', cantidad_pack: 400, unidad_pack: 'g', precio_lista: 1350.00, descuento: 400.00, precio_unitario_neto: 1250.00, subtotal: 5000.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7798159714239', producto: 'Garrapiñada de Maní Carrefour Bolsa x 80 grs', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 80, unidad_pack: 'g', precio_lista: 1250.00, descuento: 100.00, precio_unitario_neto: 1150.00, subtotal: 1150.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791720038529', producto: 'Polvo para Hornear Carrefour Classic x 50 grs', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 50, unidad_pack: 'g', precio_lista: 1450.00, descuento: 100.00, precio_unitario_neto: 1350.00, subtotal: 1350.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791720025123', producto: 'Aceite de Girasol Alto Omega Carrefour 1.5 Lt', cantidad_chango: 2, unidad_stock: 'un', cantidad_pack: 1.5, unidad_pack: 'l', precio_lista: 5690.00, descuento: 1000.00, precio_unitario_neto: 5190.00, subtotal: 10380.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7798033333891', producto: 'Atún en Aceite Lomitos Carrefour Lata x 170 grs', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 170, unidad_pack: 'g', precio_lista: 3290.00, descuento: 300.00, precio_unitario_neto: 2990.00, subtotal: 2990.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7791720035955', producto: 'Vinagre de Alcohol Bulnez 1 Lt', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'l', precio_lista: 1350.00, descuento: 0, precio_unitario_neto: 1350.00, subtotal: 1350.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '2509690007200', producto: 'Roast Beef Novillo x Kg', cantidad_chango: 0.720, unidad_stock: 'kg', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 12990.00, descuento: 0, precio_unitario_neto: 12990.00, subtotal: 9352.80, categoria: 'Freezer', seleccionado: true },
    { codigo_barra: '2505721006952', producto: 'Milanesa de Bola de Lomo Novillito x Kg', cantidad_chango: 0.695, unidad_stock: 'kg', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 19500.00, descuento: 0, precio_unitario_neto: 19500.00, subtotal: 13552.50, categoria: 'Freezer', seleccionado: true },
    { codigo_barra: '2509249007309', producto: 'Hígado x Kg', cantidad_chango: 0.730, unidad_stock: 'kg', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 4600.00, descuento: 0, precio_unitario_neto: 4600.00, subtotal: 3358.00, categoria: 'Heladera', seleccionado: true },
    { codigo_barra: '8124', producto: 'Papa Cepillada x Kg', cantidad_chango: 1.990, unidad_stock: 'kg', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 2999.00, descuento: 0, precio_unitario_neto: 2999.00, subtotal: 5968.01, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '4291', producto: 'Zanahoria Huella Natural x Kg', cantidad_chango: 0.665, unidad_stock: 'kg', cantidad_pack: 1, unidad_pack: 'kg', precio_lista: 1999.00, descuento: 0, precio_unitario_neto: 1999.00, subtotal: 1329.34, categoria: 'Heladera', seleccionado: true },
    { codigo_barra: '7794440003310', producto: 'Fibra Esponja Lisa Virulana x 1 uni', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'un', precio_lista: 900.00, descuento: 0, precio_unitario_neto: 900.00, subtotal: 900.00, categoria: 'Limpieza', seleccionado: true },
    { codigo_barra: '7790065000512', producto: 'Papel Aluminio Carrefour Essential 28 cm', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'un', precio_lista: 3790.00, descuento: 0, precio_unitario_neto: 3790.00, subtotal: 3790.00, categoria: 'Alacena', seleccionado: true },
    { codigo_barra: '7793344009206', producto: 'Rollo de Cocina Gigante Elegante x 200 paños', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'un', precio_lista: 1990.00, descuento: 0, precio_unitario_neto: 1990.00, subtotal: 1990.00, categoria: 'Limpieza', seleccionado: true },
    { codigo_barra: '7791293047058', producto: 'Acondicionador Reconstrucción + Amino Dove x 200 ml', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 200, unidad_pack: 'ml', precio_lista: 6619.00, descuento: 2647.60, precio_unitario_neto: 3971.40, subtotal: 3971.40, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7506306241183', producto: 'Antitranspirante Aero Original Dove x 150 ml', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 150, unidad_pack: 'ml', precio_lista: 6089.00, descuento: 0, precio_unitario_neto: 6089.00, subtotal: 6089.00, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7896015527457', producto: 'Crema Dental con Flúor Parodontax x 90 g', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 90, unidad_pack: 'g', precio_lista: 8290.00, descuento: 0, precio_unitario_neto: 8290.00, subtotal: 8290.00, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7791293048826', producto: 'Jabón Líquido Rosas Francesas Repuesto Lux x 250 ml', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 250, unidad_pack: 'ml', precio_lista: 3089.00, descuento: 772.25, precio_unitario_neto: 2316.75, subtotal: 2316.75, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7791293047102', producto: 'Shampoo Reconstrucción + Amino Dove x 400 ml', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 400, unidad_pack: 'ml', precio_lista: 11079.00, descuento: 4431.60, precio_unitario_neto: 6647.40, subtotal: 6647.40, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7794640171420', producto: 'Tabletas Limpiadoras de Prótesis Corega', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'un', precio_lista: 9890.00, descuento: 2472.50, precio_unitario_neto: 7417.50, subtotal: 7417.50, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '7702003010774', producto: 'Apósitos de Tela Transpiel Curitas x 10', cantidad_chango: 1, unidad_stock: 'un', cantidad_pack: 10, unidad_pack: 'un', precio_lista: 1430.00, descuento: 357.50, precio_unitario_neto: 1072.50, subtotal: 1072.50, categoria: 'Perfumería', seleccionado: true },
    { codigo_barra: '2633169000000', producto: 'Bolsa Camiseta Verde 45x55x17 Mic Oxobio', cantidad_chango: 3, unidad_stock: 'un', cantidad_pack: 1, unidad_pack: 'un', precio_lista: 110.00, descuento: 0, precio_unitario_neto: 110.00, subtotal: 330.00, categoria: 'Limpieza', seleccionado: false }
  ]
};

export function abrirModalTicket() {
  if (!modalTicketBackdrop) return;
  modalTicketBackdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function cerrarModalTicket() {
  if (!modalTicketBackdrop) return;
  modalTicketBackdrop.classList.add('hidden');
  document.body.style.overflow = '';
}

export function cargarTicketCarrefourPrecargado() {
  ticketParseadoActual = JSON.parse(JSON.stringify(TICKET_CARREFOUR_16_11_2026));
  renderizarVistaPreviaTicket();
  mostrarToast('Ticket de Carrefour (16/11) cargado en vista previa', 'success');
}

function extraerPackYUnidadDeNombre(nombre) {
  const texto = String(nombre || '').toUpperCase();
  const matchGr = texto.match(/X\s*(\d+(?:[.,]\d+)?)\s*(GRS|GR|G)\b/);
  if (matchGr) return { cantidad_pack: parseFloat(matchGr[1].replace(',', '.')), unidad_pack: 'g' };

  const matchKg = texto.match(/X\s*(\d+(?:[.,]\d+)?)\s*(KGS|KG)\b/);
  if (matchKg) return { cantidad_pack: parseFloat(matchKg[1].replace(',', '.')), unidad_pack: 'kg' };

  const matchMl = texto.match(/X\s*(\d+(?:[.,]\d+)?)\s*(ML|CC)\b/);
  if (matchMl) return { cantidad_pack: parseFloat(matchMl[1].replace(',', '.')), unidad_pack: 'ml' };

  const matchLt = texto.match(/(?:X\s*)?(\d+(?:[.,]\d+)?)\s*(LTS|LT|L)\b/);
  if (matchLt) return { cantidad_pack: parseFloat(matchLt[1].replace(',', '.')), unidad_pack: 'l' };

  return { cantidad_pack: 1, unidad_pack: 'un' };
}

function capitalizarProductoTicket(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

export function parsearTextoTicket(textoRaw) {
  const lineas = String(textoRaw || '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  let comercio = 'Carrefour';
  const todoUpper = textoRaw.toUpperCase();
  if (todoUpper.includes('COTO')) comercio = 'Coto';
  else if (todoUpper.includes('CHANGOMAS') || todoUpper.includes('DORINKA')) comercio = 'ChangoMás';
  else if (todoUpper.includes('DIA ARGENTINA')) comercio = 'Día';
  else if (todoUpper.includes('JUMBO') || todoUpper.includes('CENCOSUD')) comercio = 'Jumbo';
  else if (todoUpper.includes('CARREFOUR') || todoUpper.includes('INC SA') || todoUpper.includes('30-68731043-4')) comercio = 'Carrefour';

  let categoriaActual = 'Alacena';
  const items = [];
  let ultimoNombreCandidato = '';

  const mapaSecciones = {
    'ALMACEN': 'Alacena',
    'ALMACÉN': 'Alacena',
    'LACTEOS': 'Heladera',
    'LÁCTEOS': 'Heladera',
    'CARNICERIA': 'Freezer',
    'CARNICERÍA': 'Freezer',
    'FRUTAS Y VERDURAS': 'Heladera',
    'VERDULERIA': 'Heladera',
    'HOGAR BAZAR': 'Limpieza',
    'LIMPIEZA': 'Limpieza',
    'PERFUMERIA': 'Perfumería',
    'PERFUMERÍA': 'Perfumería',
    'OTROS': 'General'
  };

  const regexPesable = /^(\d+)\s*[xX]\s*(\d+[.,]\d+)\s*[xX]\s*(\d+[.,]\d+)\s*(?:\([\d.,]+%\))?\s*(\d+[.,]\d+)$/;
  const regexUnidades = /^(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+[.,]\d+)\s*(?:\([\d.,]+%\))?\s*(\d+[.,]\d+)$/;
  const regexDescuento = /^(.+?)\s+(-\d+[.,]\d+)$/;
  const regexBarcode = /^(\d{4,14})$/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const upper = linea.toUpperCase();

    if (
      upper.startsWith('SUBTOTAL SIN DESCUENTOS') ||
      upper === 'DESCUENTOS' ||
      upper.startsWith('====') ||
      upper.startsWith('TOTAL $') ||
      upper.startsWith('REG.TRANSPARENCIA')
    ) {
      break;
    }

    if (mapaSecciones[upper]) {
      categoriaActual = mapaSecciones[upper];
      ultimoNombreCandidato = '';
      continue;
    }

    const mPesable = linea.match(regexPesable);
    if (mPesable && ultimoNombreCandidato) {
      const peso = parseFloat(mPesable[2].replace(',', '.'));
      const precioKg = parseFloat(mPesable[3].replace(',', '.'));
      const subtotalBruto = parseFloat(mPesable[4].replace(',', '.'));
      items.push({
        codigo_barra: null,
        producto: capitalizarProductoTicket(ultimoNombreCandidato),
        cantidad_chango: Number(peso.toFixed(3)),
        unidad_stock: 'kg',
        cantidad_pack: 1,
        unidad_pack: 'kg',
        precio_lista: Number(precioKg.toFixed(2)),
        descuento: 0,
        precio_unitario_neto: Number(precioKg.toFixed(2)),
        subtotal: Number(subtotalBruto.toFixed(2)),
        categoria: categoriaActual,
        seleccionado: true
      });
      ultimoNombreCandidato = '';
      continue;
    }

    const mUnidades = linea.match(regexUnidades);
    if (mUnidades && ultimoNombreCandidato) {
      const cant = parseFloat(mUnidades[1].replace(',', '.'));
      const precioUnit = parseFloat(mUnidades[2].replace(',', '.'));
      const subtotalBruto = parseFloat(mUnidades[3].replace(',', '.'));
      const { cantidad_pack, unidad_pack } = extraerPackYUnidadDeNombre(ultimoNombreCandidato);
      const esBolsa = ultimoNombreCandidato.toUpperCase().includes('BOLSA CAMISETA');

      items.push({
        codigo_barra: null,
        producto: capitalizarProductoTicket(ultimoNombreCandidato),
        cantidad_chango: Number(cant.toFixed(3)),
        unidad_stock: 'un',
        cantidad_pack,
        unidad_pack,
        precio_lista: Number(precioUnit.toFixed(2)),
        descuento: 0,
        precio_unitario_neto: Number(precioUnit.toFixed(2)),
        subtotal: Number(subtotalBruto.toFixed(2)),
        categoria: categoriaActual,
        seleccionado: !esBolsa
      });
      ultimoNombreCandidato = '';
      continue;
    }

    const mDto = linea.match(regexDescuento);
    if (mDto && items.length > 0) {
      const montoDto = Math.abs(parseFloat(mDto[2].replace(',', '.')));
      const ultimoItem = items[items.length - 1];
      ultimoItem.descuento = Number((ultimoItem.descuento + montoDto).toFixed(2));
      ultimoItem.subtotal = Number(Math.max(0.01, ultimoItem.subtotal - montoDto).toFixed(2));
      if (ultimoItem.unidad_stock === 'un' && ultimoItem.cantidad_chango > 0) {
        ultimoItem.precio_unitario_neto = Number((ultimoItem.subtotal / ultimoItem.cantidad_chango).toFixed(2));
      }
      continue;
    }

    const mCode = linea.match(regexBarcode);
    if (mCode && items.length > 0 && !items[items.length - 1].codigo_barra) {
      items[items.length - 1].codigo_barra = mCode[1];
      continue;
    }

    if (
      !upper.startsWith('---') &&
      !upper.startsWith('FACTURA ') &&
      !upper.startsWith('A CONSUMIDOR') &&
      !upper.startsWith('P.V.') &&
      !upper.startsWith('FECHA ') &&
      !upper.startsWith('CAJA ') &&
      !upper.startsWith('INC SA') &&
      !upper.startsWith('IBCM') &&
      !upper.startsWith('ORIENTACION') &&
      !upper.startsWith('IVA RESPONSABLE') &&
      linea.length >= 3
    ) {
      ultimoNombreCandidato = linea;
    }
  }

  const totalNeto = items.reduce((acc, it) => acc + Number(it.subtotal), 0);
  const ahorroTotal = items.reduce((acc, it) => acc + Number(it.descuento || 0), 0);

  return {
    comercio,
    totalNeto: Number(totalNeto.toFixed(2)),
    ahorroTotal: Number(ahorroTotal.toFixed(2)),
    items
  };
}

export function renderizarVistaPreviaTicket() {
  if (!ticketParseadoActual || !ticketPreviewWrap || !ticketItemsPreviewList) return;

  ticketPreviewWrap.classList.remove('hidden');
  if (inputTicketComercio) inputTicketComercio.value = ticketParseadoActual.comercio || 'Carrefour';

  const seleccionados = ticketParseadoActual.items.filter((i) => i.seleccionado);
  const totalCalculado = ticketParseadoActual.items.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
  const ahorro = Number(ticketParseadoActual.ahorroTotal || 0);

  if (ticketPreviewTotal) {
    ticketPreviewTotal.textContent = `$${totalCalculado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (ticketPreviewMeta) {
    const ahorroTxt = ahorro > 0
      ? ` · Ahorro en descuentos: $${ahorro.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
      : '';
    ticketPreviewMeta.textContent = `${seleccionados.length} de ${ticketParseadoActual.items.length} productos seleccionados para Stock${ahorroTxt}`;
  }

  ticketItemsPreviewList.innerHTML = ticketParseadoActual.items.map((item, idx) => {
    const subFmt = Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dtoTag = item.descuento > 0
      ? ` · Dto -$${Number(item.descuento).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
      : '';
    return `
      <div class="ticket-item-preview-row">
        <label class="ticket-item-preview-left">
          <input type="checkbox" class="chk-ticket-item" data-idx="${idx}" ${item.seleccionado ? 'checked' : ''}>
          <div class="ticket-item-preview-info">
            <span class="ticket-item-preview-title">${escapeHTML(item.producto)}</span>
            <span class="ticket-item-preview-sub">
              ${item.cantidad_chango} ${item.unidad_stock} · ${escapeHTML(item.categoria)}${item.codigo_barra ? ` · #${escapeHTML(item.codigo_barra)}` : ''}${dtoTag}
            </span>
          </div>
        </label>
        <span class="ticket-item-preview-price">$${subFmt}</span>
      </div>
    `;
  }).join('');

  ticketItemsPreviewList.querySelectorAll('.chk-ticket-item').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const idx = Number(e.target.getAttribute('data-idx'));
      if (ticketParseadoActual?.items[idx]) {
        ticketParseadoActual.items[idx].seleccionado = e.target.checked;
        renderizarVistaPreviaTicket();
      }
    });
  });
}

async function cargarScriptDinamico(src) {
  return new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${src}"]`);
    if (existente) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

export async function procesarArchivoTicket(file) {
  if (!file) return;
  if (ticketUploadStatus) {
    ticketUploadStatus.textContent = `⏳ Analizando "${file.name}"...`;
  }

  try {
    let textoExtraido = '';
    const nombreLower = file.name.toLowerCase();

    if (file.type === 'text/plain' || nombreLower.endsWith('.txt')) {
      textoExtraido = await file.text();
    } else if (file.type === 'application/pdf' || nombreLower.endsWith('.pdf')) {
      await cargarScriptDinamico('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const paginasTexto = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const filasPorY = new Map();

        textContent.items.forEach((item) => {
          const str = (item.str || '').trim();
          if (!str) return;
          const yKey = Math.round(item.transform[5] / 3) * 3;
          if (!filasPorY.has(yKey)) filasPorY.set(yKey, []);
          filasPorY.get(yKey).push({ x: item.transform[4], str });
        });

        const yOrdenadas = [...filasPorY.keys()].sort((a, b) => b - a);
        const lineasPagina = yOrdenadas.map((y) => {
          const fila = filasPorY.get(y).sort((a, b) => a.x - b.x);
          return fila.map((f) => f.str).join(' ');
        });
        paginasTexto.push(lineasPagina.join('\n'));
      }

      textoExtraido = paginasTexto.join('\n');

      // Si el PDF es una imagen escaneada (sin capa de texto), usar OCR con Tesseract.js
      if (textoExtraido.replace(/\s+/g, '').length < 40) {
        if (ticketUploadStatus) {
          ticketUploadStatus.textContent = '🔍 PDF escaneado detectado. Ejecutando OCR sobre el ticket...';
        }
        await cargarScriptDinamico('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const { data: { text } } = await window.Tesseract.recognize(canvas, 'spa');
        textoExtraido = text;
      }
    } else if (file.type.startsWith('image/')) {
      if (ticketUploadStatus) {
        ticketUploadStatus.textContent = '🔍 Leyendo imagen del ticket con OCR...';
      }
      await cargarScriptDinamico('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
      const { data: { text } } = await window.Tesseract.recognize(file, 'spa');
      textoExtraido = text;
    }

    if (textareaTicketRaw) textareaTicketRaw.value = textoExtraido;
    const resultado = parsearTextoTicket(textoExtraido);

    if (!resultado.items || resultado.items.length === 0) {
      if (ticketUploadStatus) {
        ticketUploadStatus.textContent = '⚠️ No se detectaron líneas con formato automático. Revisá el texto o usá el botón rápido de arriba.';
      }
      mostrarToast('No se detectaron productos automáticamente en ese archivo.', 'info');
      return;
    }

    ticketParseadoActual = resultado;
    renderizarVistaPreviaTicket();
    if (ticketUploadStatus) {
      ticketUploadStatus.textContent = `✅ ¡Listo! Se detectaron ${resultado.items.length} productos de ${resultado.comercio}.`;
    }
    mostrarToast(`Se detectaron ${resultado.items.length} productos del ticket`, 'success');
  } catch (err) {
    console.error('Error procesando ticket PDF:', err);
    if (ticketUploadStatus) {
      ticketUploadStatus.textContent = `❌ Error al leer el archivo: ${err.message}`;
    }
    mostrarToast(`No se pudo procesar el archivo: ${err.message}`, 'error');
  }
}

export async function confirmarImportacionTicket() {
  if (!ticketParseadoActual || !Array.isArray(ticketParseadoActual.items) || ticketParseadoActual.items.length === 0) {
    mostrarToast('Primero cargá o seleccioná un ticket.', 'error');
    return;
  }

  const comercio = inputTicketComercio?.value.trim() || ticketParseadoActual.comercio || 'Carrefour';
  const guardarEnHistorial = Boolean(chkTicketHistorial?.checked);
  const guardarEnStock = Boolean(chkTicketStock?.checked);
  const guardarEnPrecios = Boolean(chkTicketPrecios?.checked);
  const guardarEnChango = Boolean(chkTicketChango?.checked);

  if (!guardarEnHistorial && !guardarEnStock && !guardarEnPrecios && !guardarEnChango) {
    mostrarToast('Elegí al menos un destino donde importar.', 'error');
    return;
  }

  if (btnConfirmarImportarTicket) {
    btnConfirmarImportarTicket.disabled = true;
    btnConfirmarImportarTicket.textContent = '⏳ Importando...';
  }

  try {
    const todosLosItems = ticketParseadoActual.items;
    const itemsSeleccionados = todosLosItems.filter((i) => i.seleccionado);
    const totalTicket = todosLosItems.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

    // 1. Guardar en Historial de Compras (incluye todo el ticket tal como se pagó)
    if (guardarEnHistorial) {
      const itemsParaHistorial = todosLosItems.map((it) => ({
        producto: it.producto,
        comercio,
        codigo_barra: it.codigo_barra || null,
        precio_total: Number((Number(it.subtotal) / Number(it.cantidad_chango || 1)).toFixed(2)),
        cantidad_pack: Number(it.cantidad_pack || 1),
        unidad: it.unidad_pack || 'un',
        cantidad_chango: Number(it.cantidad_chango || 1),
        subtotal: Number(it.subtotal)
      }));
      await registrarCompraEnHistorial(itemsParaHistorial, totalTicket);
    }

    // 2. Sumar productos seleccionados a Stock en Casa
    if (guardarEnStock) {
      for (const it of itemsSeleccionados) {
        await sumarOActualizarEnStock({
          codigo_barra: it.codigo_barra || null,
          producto: it.producto,
          cantidad: Number(it.cantidad_chango || 1),
          unidad: it.unidad_stock || 'un',
          categoria: it.categoria || 'General'
        });
      }
    }

    // 3. Registrar precios unitarios en Precios de Góndola (Comparador)
    if (guardarEnPrecios) {
      for (const it of itemsSeleccionados) {
        const yaRegistradoIgual = listaPrecios.some(
          (p) =>
            p.comercio?.toLowerCase() === comercio.toLowerCase() &&
            ((it.codigo_barra && p.codigo_barra === it.codigo_barra) ||
              p.producto?.toLowerCase() === it.producto.toLowerCase()) &&
            Math.abs(Number(p.precio_total) - Number(it.precio_unitario_neto)) < 1
        );
        if (!yaRegistradoIgual) {
          try {
            await registrarPrecioEnBase(
              {
                codigo_barra: it.codigo_barra || null,
                comercio,
                producto: it.producto,
                precio_total: Number(it.precio_unitario_neto),
                cantidad: Number(it.cantidad_pack || 1),
                unidad: it.unidad_pack || 'un'
              },
              true
            );
          } catch (e) {
            console.warn('Aviso al sincronizar precio individual:', e);
          }
        }
      }
    }

    // 4. Opcional: Cargar en Mi Chango actual
    if (guardarEnChango) {
      for (const it of itemsSeleccionados) {
        await agregarItemAlChango({
          comercio,
          codigo_barra: it.codigo_barra || null,
          producto: it.producto,
          precio_total: Number(it.precio_unitario_neto),
          cantidad_pack: Number(it.cantidad_pack || 1),
          unidad: it.unidad_pack || 'un',
          cantidad_chango: Number(it.cantidad_chango || 1),
          actualizarPrecio: false
        });
      }
    }

    renderizarDashboard();
    renderizarChango();
    renderizarStock();
    cerrarModalTicket();
    mostrarToast(
      `¡Ticket de ${comercio} ($${totalTicket.toLocaleString('es-AR', { minimumFractionDigits: 2 })}) importado con éxito!`,
      'success'
    );
  } catch (err) {
    console.error('Error importando ticket:', err);
    mostrarToast(`Error al importar: ${err.message}`, 'error');
  } finally {
    if (btnConfirmarImportarTicket) {
      btnConfirmarImportarTicket.disabled = false;
      btnConfirmarImportarTicket.textContent = '🚀 Importar Todo';
    }
  }
}

/* ==========================================================================
   Inicialización de Eventos del DOM
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Navegación de Vistas (Segmented Control)
  tabRecientes?.addEventListener('click', () => cambiarVista('recientes'));
  tabComparador?.addEventListener('click', () => cambiarVista('comparador'));
  tabComercios?.addEventListener('click', () => cambiarVista('comercios'));
  tabChango?.addEventListener('click', () => cambiarVista('chango'));
  tabStock?.addEventListener('click', () => cambiarVista('stock'));

  // Buscador reactivo
  inputBuscar?.addEventListener('input', () => renderizarDashboard());

  // Eventos de Autenticación
  btnLoginOpen?.addEventListener('click', abrirModalAuth);
  btnCerrarAuth?.addEventListener('click', cerrarModalAuth);
  btnAuthGoogle?.addEventListener('click', () => iniciarSesionOAuth('google'));
  btnAuthFacebook?.addEventListener('click', () => iniciarSesionOAuth('facebook'));
  formAuthEmail?.addEventListener('submit', iniciarSesionEmail);
  btnAuthMagicLink?.addEventListener('click', iniciarSesionMagicLink);
  btnLogout?.addEventListener('click', cerrarSesion);

  modalAuthBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalAuthBackdrop) cerrarModalAuth();
  });

  // Apertura y Cierre del Bottom Sheet Modal de Precios
  btnFabCarga?.addEventListener('click', () => {
    if (vistaActual === 'chango') {
      abrirModalCarga(false, { modoChango: true });
      return;
    }
    if (vistaActual === 'stock') {
      abrirModalStock(null);
      return;
    }
    if (!usuarioActual) {
      mostrarToast('Iniciá sesión para registrar precios', 'info');
      abrirModalAuth();
      return;
    }
    abrirModalCarga(false);
  });

  btnBannerScan?.addEventListener('click', () => {
    if (vistaActual === 'chango') {
      abrirModalCarga(true, { modoChango: true });
      return;
    }
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

  // Toggle de Chango dentro del Modal de Precios
  checkAgregarChango?.addEventListener('change', (e) => {
    const activo = e.target.checked;
    changoExtrasFields?.classList.toggle('hidden', !activo);
    if (btnGuardarText) {
      btnGuardarText.textContent = activo ? 'Agregar al Chango' : 'Guardar Precio';
    }
  });

  // Eventos Vista Mi Chango
  btnChangoAgregar?.addEventListener('click', () => abrirModalCarga(false, { modoChango: true }));
  btnChangoFinalizar?.addEventListener('click', finalizarCompraChango);
  btnChangoVaciar?.addEventListener('click', () => vaciarChango(true));
  btnChangoCambiarComercio?.addEventListener('click', () => {
    if (!changoCambiarComercioBar) return;
    const oculto = changoCambiarComercioBar.classList.toggle('hidden');
    if (!oculto) {
      poblarSelectComercios();
      selectChangoNuevoComercio?.focus();
    }
  });
  btnAplicarComercioChango?.addEventListener('click', () => {
    cambiarComercioTodoElChango(selectChangoNuevoComercio?.value);
  });
  inputChangoPresupuesto?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    presupuestoChango = isNaN(val) || val <= 0 ? 0 : val;
    try {
      localStorage.setItem(LOCAL_STORAGE_CHANGO_BUDGET, String(presupuestoChango));
    } catch (err) {}
    renderizarChango();
  });

  // Eventos Vista Stock Casa y Modal Stock
  btnStockFiltroTodos?.addEventListener('click', () => {
    filtroStock = 'todos';
    btnStockFiltroTodos.classList.add('active');
    btnStockFiltroBajo?.classList.remove('active');
    renderizarStock();
  });
  btnStockFiltroBajo?.addEventListener('click', () => {
    filtroStock = 'bajo';
    btnStockFiltroBajo.classList.add('active');
    btnStockFiltroTodos?.classList.remove('active');
    renderizarStock();
  });
  btnStockAgregar?.addEventListener('click', () => abrirModalStock(null));
  btnCerrarModalStock?.addEventListener('click', cerrarModalStock);
  btnCancelarStock?.addEventListener('click', cerrarModalStock);
  formStock?.addEventListener('submit', guardarItemStock);
  modalStockBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalStockBackdrop) cerrarModalStock();
  });
  btnScanStock?.addEventListener('click', () => {
    if (escanerStockActivo) detenerEscanerStock();
    else iniciarEscanerStock();
  });
  btnCerrarEscanerStock?.addEventListener('click', detenerEscanerStock);
  inputStockCodigo?.addEventListener('input', (e) => {
    const limpio = e.target.value.trim();
    if (!limpio) return;
    const match = listaPrecios.find((p) => p.codigo_barra === limpio);
    if (match && inputStockProducto && !inputStockProducto.value) {
      inputStockProducto.value = match.producto;
      if (selectStockUnidad && match.unidad) selectStockUnidad.value = match.unidad;
    }
  });

  // Eventos Hogar Compartido
  btnHogarChango?.addEventListener('click', abrirModalHogar);
  btnHogarStock?.addEventListener('click', abrirModalHogar);
  btnCerrarModalHogar?.addEventListener('click', cerrarModalHogar);
  modalHogarBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalHogarBackdrop) cerrarModalHogar();
  });
  formCrearHogar?.addEventListener('submit', crearHogar);
  formUnirseHogar?.addEventListener('submit', (e) => {
    e.preventDefault();
    unirseAHogarPorCodigo(inputHogarCodigo?.value);
  });
  btnHogarCopiar?.addEventListener('click', async () => {
    if (!hogarActual?.codigo_invitacion) return;
    try {
      await navigator.clipboard.writeText(hogarActual.codigo_invitacion);
      mostrarToast(`Código ${hogarActual.codigo_invitacion} copiado`, 'success');
    } catch {
      mostrarToast(`Código: ${hogarActual.codigo_invitacion}`, 'info');
    }
  });
  btnHogarCompartir?.addEventListener('click', async () => {
    if (!hogarActual?.codigo_invitacion) return;
    const url = `${window.location.origin}${window.location.pathname}?hogar=${encodeURIComponent(hogarActual.codigo_invitacion)}`;
    const texto = `Unite a nuestro hogar "${hogarActual.nombre}" en ChangoCheck para compartir el chango y el stock: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Invitación ChangoCheck', text: texto, url });
        return;
      } catch (e) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      mostrarToast('Enlace de invitación copiado para compartir', 'success');
    } catch {
      mostrarToast(url, 'info');
    }
  });
  btnHogarRegenerar?.addEventListener('click', regenerarCodigoHogar);
  btnHogarSalir?.addEventListener('click', salirDelHogar);

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

  // Eventos Importador de Tickets PDF / Factura Electrónica
  btnImportarTicketChango?.addEventListener('click', abrirModalTicket);
  btnImportarTicketStock?.addEventListener('click', abrirModalTicket);
  btnCerrarModalTicket?.addEventListener('click', cerrarModalTicket);
  btnCancelarTicket?.addEventListener('click', cerrarModalTicket);
  modalTicketBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalTicketBackdrop) cerrarModalTicket();
  });
  btnCargarTicketCarrefourPrecargado?.addEventListener('click', cargarTicketCarrefourPrecargado);
  btnSeleccionarArchivoTicket?.addEventListener('click', () => inputTicketFile?.click());
  inputTicketFile?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) procesarArchivoTicket(file);
  });
  btnParsearTextoTicket?.addEventListener('click', () => {
    const raw = textareaTicketRaw?.value.trim() || '';
    if (!raw) {
      mostrarToast('Pegá el texto del ticket primero.', 'info');
      return;
    }
    const res = parsearTextoTicket(raw);
    if (!res.items || res.items.length === 0) {
      mostrarToast('No se detectaron productos en el texto pegado.', 'error');
      return;
    }
    ticketParseadoActual = res;
    renderizarVistaPreviaTicket();
    mostrarToast(`Se detectaron ${res.items.length} productos`, 'success');
  });
  btnConfirmarImportarTicket?.addEventListener('click', confirmarImportacionTicket);

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalAuthBackdrop?.classList.contains('hidden')) {
        cerrarModalAuth();
      } else if (!modalTicketBackdrop?.classList.contains('hidden')) {
        cerrarModalTicket();
      } else if (!modalHogarBackdrop?.classList.contains('hidden')) {
        cerrarModalHogar();
      } else if (!modalStockBackdrop?.classList.contains('hidden')) {
        cerrarModalStock();
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

  // Carga inicial, sesión y Suscripciones Realtime
  inicializarSesion().finally(async () => {
    cargarComerciosIniciales();
    cargarPreciosIniciales();
    await procesarInvitacionPendiente();
    await cargarHogarInicial();
    cargarChangoInicial();
    cargarHistorialInicial();
    cargarStockInicial();
    suscribirRealtime();
    suscribirRealtimeHogar();
  });
});
