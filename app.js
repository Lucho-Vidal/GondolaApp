/**
 * ChangoCheck — Lógica de Aplicación
 * ES Modules nativo sin bundlers
 * T-04: Módulo de Cámara y Escáner (html5-qrcode)
 * T-05: Cliente Supabase, Normalización de Precios, Autocompletado y Formulario
 * T-06: Sincronización Realtime, Búsqueda en Memoria y Renderizado Reactivo
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ==========================================================================
   Configuración de Supabase
   (Remplazá estas constantes con la URL y Anon Key de tu proyecto Supabase)
   ========================================================================== */
export const SUPABASE_URL = window.__SUPABASE_URL__ || localStorage.getItem('SUPABASE_URL') || 'https://xyzcompany.supabase.co';
export const SUPABASE_KEY = window.__SUPABASE_KEY__ || localStorage.getItem('SUPABASE_KEY') || 'public-anon-key-placeholder';

// Inicialización del cliente Supabase
export let supabase = null;
const esPlaceholder = SUPABASE_URL.includes('xyzcompany') || SUPABASE_KEY.includes('placeholder');

try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.warn('No se pudo inicializar el cliente de Supabase:', e);
}

/* ==========================================================================
   Estado de la Aplicación en Memoria
   ========================================================================== */
export let listaPrecios = [];
let html5QrCode = null;
let escanerActivo = false;
let toastTimeout = null;
let realtimeChannel = null;

/* ==========================================================================
   Elementos del DOM
   ========================================================================== */
const scannerSection = document.getElementById('scanner-section');
const btnToggleScan = document.getElementById('btn-toggle-scan');
const btnCerrarEscaner = document.getElementById('btn-cerrar-escaner');
const btnCancelarEscaner = document.getElementById('btn-cancelar-escaner');
const btnScanText = document.getElementById('btn-scan-text');

const formPrecio = document.getElementById('form-precio');
const inputCodigo = document.getElementById('codigo-barra');
const inputComercio = document.getElementById('comercio');
const inputProducto = document.getElementById('producto');
const inputPrecio = document.getElementById('precio-total');
const inputCantidad = document.getElementById('cantidad');
const selectUnidad = document.getElementById('unidad');
const previewValor = document.getElementById('precio-unitario-val');
const btnGuardar = document.getElementById('btn-guardar');

const inputBuscar = document.getElementById('input-buscar');
const contenedorLista = document.getElementById('lista-precios');
const emptyState = document.getElementById('empty-state');
const badgeConteo = document.getElementById('precios-count');
const statusLabel = document.getElementById('status-label');
const statusBadge = document.getElementById('status-badge');
const toastEl = document.getElementById('toast');

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

/* ==========================================================================
   T-05: Regla de Negocio — Normalización de Precio Unitario
   ========================================================================== */
/**
 * Normaliza el costo por unidad base (kg, l o un) según las especificaciones técnicas
 * @param {number} precioTotal 
 * @param {number} cantidad 
 * @param {'kg'|'g'|'l'|'ml'|'un'} unidad 
 * @returns {{ precioUnitario: number, unidadBase: string }}
 */
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
      // 500 g a $1500 -> (1500 / 500) * 1000 = $3000 / kg (CA-04)
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

/**
 * Actualiza la caja interactiva de preview unitario en el formulario
 */
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
   T-05: Autocompletado Histórico por Código de Barras (US-02 / CA-03)
   ========================================================================== */
/**
 * Al detectar o tipear un código de barras, busca si existe en el historial
 * y precarga automáticamente el nombre del producto si el campo está vacío.
 */
export function buscarAutocompletadoProducto(codigo) {
  if (!codigo || !codigo.trim()) return;
  const limpio = codigo.trim();

  // Buscar en el estado en memoria el registro más reciente con ese código
  const coincidencia = listaPrecios.find((item) => item.codigo_barra === limpio);
  if (coincidencia && coincidencia.producto) {
    if (inputProducto) {
      inputProducto.value = coincidencia.producto;
      mostrarToast(`Autocompletado: ${coincidencia.producto}`, 'info');
    }
  }
}

/* ==========================================================================
   T-04: Módulo de Cámara y Escaneo de Códigos de Barras
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

      mostrarToast(`Código: ${decodedText}`, 'success');
      await detenerEscaner();

      // Autocompletado inmediato
      buscarAutocompletadoProducto(decodedText);

      // Enfocar siguiente campo
      if (inputComercio && !inputComercio.value) {
        inputComercio.focus();
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

  scannerSection.classList.add('hidden');
  btnScanText.textContent = 'Escanear';
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
   T-05: Inserción y Persistencia en Supabase
   ========================================================================== */
export async function guardarPrecio(e) {
  e.preventDefault();

  const codigo = inputCodigo?.value.trim() || null;
  const comercio = inputComercio?.value.trim();
  const producto = inputProducto?.value.trim();
  const precioTotal = parseFloat(inputPrecio?.value);
  const cantidad = parseFloat(inputCantidad?.value);
  const unidad = selectUnidad?.value;

  if (!comercio || !producto || isNaN(precioTotal) || precioTotal <= 0 || isNaN(cantidad) || cantidad <= 0) {
    mostrarToast('Por favor completá los campos obligatorios con valores mayores a 0.', 'error');
    return;
  }

  const { precioUnitario, unidadBase } = normalizarPrecioUnitario(precioTotal, cantidad, unidad);

  const nuevoRegistro = {
    codigo_barra: codigo,
    comercio,
    producto,
    precio_total: Number(precioTotal.toFixed(2)),
    cantidad: Number(cantidad.toFixed(3)),
    unidad,
    precio_unitario: precioUnitario
  };

  btnGuardar.disabled = true;
  btnGuardar.classList.add('loading');

  try {
    if (supabase && !esPlaceholder) {
      const { data, error } = await supabase
        .from('precios')
        .insert([nuevoRegistro])
        .select();

      if (error) throw error;
      mostrarToast('¡Precio guardado en Supabase!', 'success');
    } else {
      // Modo Mock/Offline local si no están configuradas las credenciales de Supabase
      const simulado = {
        ...nuevoRegistro,
        id: Date.now(),
        created_at: new Date().toISOString()
      };
      agregarOActualizarRegistro(simulado);
      mostrarToast('Precio guardado (modo local / pendiente de Supabase)', 'success');
    }

    // Regla US-04 / CA-05: Conservar el campo 'comercio' y resetear el resto
    try {
      localStorage.setItem(LOCAL_STORAGE_COMERCIO, comercio);
    } catch (e) {}
    if (inputCodigo) inputCodigo.value = '';
    if (inputProducto) inputProducto.value = '';
    if (inputPrecio) inputPrecio.value = '';
    if (inputCantidad) inputCantidad.value = '1';
    actualizarPreviewUnitario();

    // Enfocar producto o código para la próxima carga rápida
    if (inputCodigo) inputCodigo.focus();

  } catch (err) {
    console.error('Error al guardar en Supabase:', err);
    mostrarToast(`Error al guardar: ${err.message || 'Error de conexión'}`, 'error');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.classList.remove('loading');
  }
}

/* ==========================================================================
   T-06: Sincronización Realtime y Estado
   ========================================================================== */
const LOCAL_STORAGE_KEY = 'changocheck_precios_cache';
const LOCAL_STORAGE_COMERCIO = 'changocheck_last_comercio';

function guardarCacheLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(listaPrecios));
  } catch (e) {
    console.warn('No se pudo guardar caché local:', e);
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

export function agregarOActualizarRegistro(registro) {
  // Evitar duplicados si ya existe por id
  const index = listaPrecios.findIndex((item) => item.id === registro.id);
  if (index >= 0) {
    listaPrecios[index] = registro;
  } else {
    listaPrecios.unshift(registro);
  }

  // Ordenar siempre por fecha descendente
  listaPrecios.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  guardarCacheLocal();
  renderizarListaPrecios();
}

export function eliminarRegistroPorId(id) {
  listaPrecios = listaPrecios.filter((item) => String(item.id) !== String(id));
  guardarCacheLocal();
  renderizarListaPrecios();
}

export async function eliminarPrecio(id) {
  if (!confirm('¿Deseas eliminar este registro de precio?')) return;

  try {
    if (supabase && !esPlaceholder) {
      const { error } = await supabase
        .from('precios')
        .delete()
        .eq('id', id);

      if (error) throw error;
      eliminarRegistroPorId(id);
      mostrarToast('Precio eliminado de Supabase', 'info');
    } else {
      eliminarRegistroPorId(id);
      mostrarToast('Registro eliminado localmente', 'info');
    }
  } catch (err) {
    console.error('Error al eliminar registro:', err);
    mostrarToast(`No se pudo eliminar: ${err.message}`, 'error');
  }
}

/**
 * Carga inicial de datos desde Supabase con fallback a caché local (CA-08)
 */
export async function cargarPreciosIniciales() {
  // Cargar de inmediato desde la caché local para renderizado instantáneo
  const cacheLocal = recuperarCacheLocal();
  if (cacheLocal.length > 0) {
    listaPrecios = cacheLocal;
    renderizarListaPrecios();
  }

  if (!supabase || esPlaceholder) {
    renderizarListaPrecios();
    return;
  }

  try {
    const { data, error } = await supabase
      .from('precios')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (data && data.length >= 0) {
      listaPrecios = data;
      guardarCacheLocal();
      renderizarListaPrecios();
    }
  } catch (err) {
    console.warn('Error en consulta inicial de precios a Supabase (usando caché offline):', err);
    renderizarListaPrecios();
  }
}

/**
 * Configuración de la suscripción Realtime vía supabase.channel (T-06 / CA-06)
 */
export function suscribirRealtime() {
  if (!supabase || esPlaceholder) return;

  try {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
      .channel('public:precios')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'precios' },
        (payload) => {
          console.log('Realtime INSERT detectado:', payload.new);
          agregarOActualizarRegistro(payload.new);
          mostrarToast(`Nuevo precio cargado: ${payload.new.producto}`, 'info');
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'precios' },
        (payload) => {
          console.log('Realtime DELETE detectado:', payload.old);
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
  } catch (e) {
    console.warn('Error al iniciar suscripción Realtime:', e);
  }
}

/* ==========================================================================
   T-06: Renderizado Reactivo y Buscador en Memoria
   ========================================================================== */
export function formatearFecha(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export function renderizarListaPrecios() {
  if (!contenedorLista) return;

  const termino = inputBuscar?.value.trim().toLowerCase() || '';

  // Filtro en memoria por producto, comercio o código de barras
  const filtrados = listaPrecios.filter((item) => {
    if (!termino) return true;
    const matchProducto = item.producto?.toLowerCase().includes(termino);
    const matchComercio = item.comercio?.toLowerCase().includes(termino);
    const matchCodigo = item.codigo_barra?.toLowerCase().includes(termino);
    return matchProducto || matchComercio || matchCodigo;
  });

  if (badgeConteo) {
    badgeConteo.textContent = `${filtrados.length} ${filtrados.length === 1 ? 'registro' : 'registros'}`;
  }

  if (filtrados.length === 0) {
    contenedorLista.innerHTML = `
      <div class="empty-state" id="empty-state">
        <div class="empty-icon">${termino ? '🔍' : '🛒'}</div>
        <p class="empty-title">${termino ? 'Sin coincidencias' : 'Sin precios registrados'}</p>
        <p class="empty-desc">${termino ? `No encontramos precios que coincidan con "${termino}"` : 'Escaneá un código de barras o completá el formulario para comparar precios al instante.'}</p>
      </div>
    `;
    return;
  }

  // Generación de tarjetas de precios
  const html = filtrados.map((item) => {
    const fecha = formatearFecha(item.created_at);
    const precioTotalFmt = Number(item.precio_total).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const precioUnitFmt = Number(item.precio_unitario).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const unidadBase = (item.unidad === 'g' || item.unidad === 'kg') ? 'kg'
      : (item.unidad === 'ml' || item.unidad === 'l') ? 'l' : 'un';

    return `
      <article class="price-card" data-id="${item.id}">
        <div class="price-card-header">
          <div class="price-card-info">
            <h3 class="price-card-title">${escapeHTML(item.producto)}</h3>
            <div class="price-card-badges">
              <span class="badge-comercio">${escapeHTML(item.comercio)}</span>
              ${item.codigo_barra ? `<span class="badge-codigo">#${escapeHTML(item.codigo_barra)}</span>` : ''}
              ${fecha ? `<span class="price-card-date">${fecha}</span>` : ''}
            </div>
          </div>
          <button 
            type="button" 
            class="btn-delete-item" 
            aria-label="Eliminar precio" 
            title="Eliminar este registro"
            data-delete-id="${item.id}"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>

        <div class="price-card-pricing">
          <div class="price-total-wrap">
            <span class="price-total-number">$${precioTotalFmt}</span>
            <span class="price-qty-text">(${item.cantidad} ${item.unidad})</span>
          </div>
          <div class="price-unit-tag">
            $${precioUnitFmt} / ${unidadBase}
          </div>
        </div>
      </article>
    `;
  }).join('');

  contenedorLista.innerHTML = html;

  // Asignar listeners a botones de eliminar
  contenedorLista.querySelectorAll('.btn-delete-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      if (id) eliminarPrecio(id);
    });
  });
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
   Inicialización de Eventos del DOM
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Eventos de escáner
  btnToggleScan?.addEventListener('click', alternarEscaner);
  btnCerrarEscaner?.addEventListener('click', detenerEscaner);
  btnCancelarEscaner?.addEventListener('click', detenerEscaner);

  // Formulario y cálculo unitario interactivo
  formPrecio?.addEventListener('submit', guardarPrecio);
  inputPrecio?.addEventListener('input', actualizarPreviewUnitario);
  inputCantidad?.addEventListener('input', actualizarPreviewUnitario);
  selectUnidad?.addEventListener('change', actualizarPreviewUnitario);

  // Autocompletado al escribir o pegar código de barras
  inputCodigo?.addEventListener('input', (e) => {
    buscarAutocompletadoProducto(e.target.value);
  });

  // Búsqueda instantánea en vivo
  inputBuscar?.addEventListener('input', () => {
    renderizarListaPrecios();
  });

  // Restaurar último comercio si existe (US-04)
  const lastComercio = localStorage.getItem(LOCAL_STORAGE_COMERCIO);
  if (lastComercio && inputComercio && !inputComercio.value) {
    inputComercio.value = lastComercio;
  }

  // Carga inicial y suscripción Realtime
  cargarPreciosIniciales();
  suscribirRealtime();
});
