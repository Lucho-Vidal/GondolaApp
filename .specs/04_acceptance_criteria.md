# 04. Criterios de Aceptación y Verificación

| ID | Criterio / Escenario | Validación Requerida | Estado |
| :--- | :--- | :--- | :--- |
| **CA-01** | Permiso y arranque de cámara | Al presionar "Escanear", el navegador solicita permiso de cámara por única vez y activa la lente trasera mostrando el visor en pantalla. | Pendiente |
| **CA-02** | Detección de código de barras | Al enfocar un código comercial (EAN-13, EAN-8 o UPC), el teléfono vibra, el visor se apaga y el código se vuelca en el input correspondiente. | Pendiente |
| **CA-03** | Autocompletado por código | Si se escanea un código previamente guardado en el historial, el campo "Producto" se llena solo con el último nombre registrado. | Pendiente |
| **CA-04** | Normalización de medidas | Al registrar 500 g a $1500, la base almacena y muestra el precio unitario calculado en $3000 / kg. | Pendiente |
| **CA-05** | Retención de comercio | Al confirmar la carga de un producto, el formulario se limpia excepto el campo "Comercio", que conserva la sucursal actual. | Pendiente |
| **CA-06** | Sincronización Realtime | Un producto guardado en el Teléfono 1 debe aparecer en la pantalla del Teléfono 2 en menos de 1,5 segundos sin refrescar el navegador. | Pendiente |
| **CA-07** | Instalabilidad PWA | Al ingresar desde Chrome en Android bajo HTTPS, el navegador debe permitir agregar el acceso directo como aplicación nativa en el launcher. | Pendiente |
| **CA-08** | Carga sin conexión (App Shell) | Al abrir la PWA sin conexión, se debe mostrar la interfaz base (buscador, botones y listado vacío) cargada desde la caché del navegador. | Pendiente |