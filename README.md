# ChangoCheck (GondolaApp) 🛒✨

PWA móvil moderna y colaborativa para comparar precios de supermercados en tiempo real, calcular precio unitario normalizado y optimizar el changuito de compras.

---

## 🔒 Arquitectura de Seguridad y Autenticación

### 1. ¿Por qué la clave de Supabase está visible en el código?
En aplicaciones frontend estáticas alojadas en **GitHub Pages** (sin un backend intermediario), la clave pública (`anon` o formato `sb_publishable_...`) **está diseñada por Supabase para ser visible en el cliente**. El navegador la envía en cada petición (`apikey`).

> [!IMPORTANT]
> **La clave que NUNCA debe publicarse en el frontend es la clave `service_role`** (clave maestra administrativa que saltea RLS).

### 2. Modelo de Autenticación Social (Google, Facebook, Email Magic Link)
En vez de accesos anónimos, la aplicación cuenta con inicio de sesión seguro con **Google**, **Facebook** o **Email**:

- **Cualquier visitante puede ver y comparar precios**: La lectura (`SELECT`) es pública para todos.
- **Solo usuarios identificados pueden subir precios**: La inserción (`INSERT`) requiere una sesión válida (`authenticated`).
- **Nadie puede borrar ni alterar precios de otros**: Las políticas RLS (`UPDATE` y `DELETE`) exigen estrictamente que `auth.uid() = user_id`.
- **Comercios base protegidos**: Coto, Carrefour, ChangoMás tienen `user_id = null`, lo que impide que cualquier usuario de la aplicación pueda eliminarlos o renombrarlos.

---

## ⚙️ Pasos para configurar Supabase

### Paso 1: Configurar URLs de Redirección (Redirect URLs)
1. En tu proyecto de [Supabase Dashboard](https://supabase.com/dashboard), andá a **Authentication** $\rightarrow$ **URL Configuration**.
2. En **Site URL**, colocá la URL de tu GitHub Pages:
   ```text
   https://lucho-vidal.github.io/GondolaApp/
   ```
3. En **Redirect URLs**, agregá:
   ```text
   https://lucho-vidal.github.io/GondolaApp/*
   http://localhost:5500/*
   http://127.0.0.1:5500/*
   ```
4. Guardá los cambios.

### Paso 2: Activar Proveedores de Autenticación (Google / Facebook / Email)
1. Andá a **Authentication** $\rightarrow$ **Providers**.
2. **Google**:
   - Activá el switch.
   - En Google Cloud Console (APIs & Services $\rightarrow$ Credentials), creá un ID de cliente OAuth Web.
   - Copiá el `Client ID` y `Client Secret` en Supabase.
   - Copiá el `Callback URL` que te da Supabase y pegalo en las *URIs de redireccionamiento autorizados* en Google Cloud.
3. **Facebook**:
   - Activá el switch en Supabase.
   - Creá una App en Meta for Developers (Facebook Login).
   - Ingresá tu `App ID` y `App Secret`.
4. **Email (Magic Link)**:
   - Ya viene activo por defecto en Supabase. Permite ingresar con un enlace directo sin contraseña.

### Paso 3: Ejecutar el script SQL de Seguridad
1. Andá a **SQL Editor** en el panel de Supabase.
2. Copiá y pegá el contenido completo del archivo [`supabase_setup.sql`](./supabase_setup.sql).
3. Hacé clic en **Run**.
4. ¡Listo! Las tablas `precios` y `comercios` quedan protegidas con políticas RLS de usuarios autenticados.

---

## 🚀 Despliegue en GitHub Pages

1. Subí los cambios a la rama principal:
   ```bash
   git add .
   git commit -m "feat(auth): integrar autenticacion social con Google, Facebook y RLS"
   git push origin main
   ```
2. En GitHub, verificá en **Settings** $\rightarrow$ **Pages** que la fuente sea `main` y `/ (root)`.
