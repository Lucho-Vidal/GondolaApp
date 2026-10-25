# 03. Plan de Tareas de Implementación (SDD)

- [x] **T-01: Infraestructura y Base de Datos (Supabase)**
  - [x] Crear proyecto en Supabase en región Sudamérica.
  - [x] Ejecutar DDL con soporte para `codigo_barra` y unidades.
  - [x] Configurar políticas RLS y activar publicación `supabase_realtime`.
  - [x] Extraer y documentar `Project URL` y `Anon Key`.

- [x] **T-02: Configuración PWA y Assets Base**
  - [x] Crear archivo `manifest.json` con metadatos de aplicación standalone.
  - [x] Generar íconos PNG en 192x192 y 512x512 dentro del directorio `icons/`.
  - [x] Crear `sw.js` con precacheo del App Shell y bypass de red para Supabase.

- [x] **T-03: Estructura HTML y Estilos Mobile First**
  - [x] Crear `index.html` con inputs numéricos (`inputmode="decimal"`), contenedor de cámara `#reader` y links a PWA.
  - [x] Crear `styles.css` con diseño táctil accesible (zonas táctiles > 44px, layout adaptable sin scroll horizontal).

- [x] **T-04: Módulo de Cámara y Escaneo de Códigos**
  - [x] Integrar librería `html5-qrcode` mediante CDN.
  - [x] Implementar funciones `iniciarEscaner()` y `detenerEscaner()` asociadas al botón toggle.
  - [x] Configurar cámara trasera (`environment`), feedback háptico y cierre automático tras detección exitosa.

- [x] **T-05: Lógica de Negocio y Cliente Supabase (`app.js`)**
  - [x] Inicializar cliente `@supabase/supabase-js` mediante ES Modules.
  - [x] Implementar cálculo de normalización de precio unitario (`kg`, `l`, `un`).
  - [x] Implementar inserción en base de datos conservando el campo `comercio`.
  - [x] Implementar detección de código repetido para autocompletar el nombre del producto.

- [x] **T-06: Sincronización en Tiempo Real y Búsqueda**
  - [x] Configurar suscripción Realtime vía `supabase.channel` para eventos `INSERT` y `DELETE`.
  - [x] Implementar filtro instantáneo de búsqueda por texto y código de barras sobre el estado en memoria.
  - [x] Implementar renderizado reactivo del listado ordenado por fecha descendente.

- [ ] **T-07: Despliegue HTTPS y Validación de Criterios**
  - [ ] Publicar proyecto en hosting HTTPS (GitHub Pages o Cloudflare Pages).
  - [ ] Ejecutar plan de pruebas en dos dispositivos móviles simultáneos. 