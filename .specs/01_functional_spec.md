# 01. Especificación Funcional — ChangoCheck

## 1. Visión del Producto
ChangoCheck es una Progressive Web App (PWA) móvil diseñada para ejecutarse directamente en el navegador del teléfono, instalarse en la pantalla de inicio y permitir la carga ágil de precios de supermercado en el punto de venta mediante escaneo de código de barras con la cámara o carga manual, sincronizando los registros en tiempo real entre múltiples dispositivos a través de Supabase.

## 2. Objetivos Principales
* **Captura ultra rápida:** Permitir el registro de un artículo en góndola en menos de 5 segundos mediante lectura de código de barras con la cámara trasera.
* **Autocompletado histórico:** Al escanear un código previamente registrado, precargar automáticamente la descripción del producto para solo actualizar precio y comercio.
* **Normalización de costos:** Calcular el precio unitario base (por kg, litro o unidad) para comparar presentaciones de distinto tamaño de forma transparente.
* **Sincronización multi-dispositivo:** Compartir en tiempo real los datos cargados entre celulares autorizados sin requerir servidores locales ni recargar la interfaz.
* **Instalabilidad y resiliencia offline:** Permitir la instalación como app nativa (PWA) y abrir la interfaz aún sin conexión mediante Service Worker.

## 3. Historias de Usuario
* **US-01 (Escaneo con cámara):** Como usuario frente a la góndola, quiero presionar un botón para activar la cámara trasera, apuntar al código de barras del producto y que el valor numérico se ingrese automáticamente en el formulario.
* **US-02 (Autocompletado de producto):** Como usuario, al escanear un código de barras ya registrado en la base, quiero que el campo "Producto" se autocomplete con el nombre previo para agilizar la carga.
* **US-03 (Cálculo y comparativa unitaria):** Como usuario, quiero ingresar el precio total y la cantidad/unidad (ej: 800 g a $2400) para que el sistema calcule automáticamente el valor por kg y me permita comparar con otras marcas.
* **US-04 (Persistencia de comercio):** Como usuario recorriendo un mismo supermercado, quiero que el campo "Comercio" conserve el último valor ingresado para no tener que tipear el nombre del local en cada artículo.
* **US-05 (Sincronización en vivo):** Como usuario que hace las compras en pareja, quiero que los precios cargados por otra persona se listen en mi pantalla inmediatamente via Supabase Realtime.
* **US-06 (Instalación PWA):** Como usuario frecuente, quiero instalar la app en la pantalla principal de Android para abrirla en pantalla completa sin barra de navegación del navegador.

## 4. Fuera de Alcance (Out of Scope - v1.0)
* Reconocimiento óptico de caracteres (OCR) sobre tickets impresos en papel.
* Autenticación individual por usuario y contraseña (acceso mediante clave compartida pública del proyecto Supabase).
* Notificaciones push nativas al detectar caídas de precios.