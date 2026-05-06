# ChoferLink listo para Render + PostgreSQL

## Variables obligatorias en Render

- `NODE_ENV=production`
- `DB_CLIENT=postgres`
- `DATABASE_URL`: la entrega Render PostgreSQL.
- `CORS_ORIGINS=https://TU-SERVICIO.onrender.com`
- `ADMIN_EMAIL`: email del administrador.
- `ADMIN_PASSWORD`: contraseña larga y única del administrador.
- `ADMIN_TOKEN`: opcional, largo y aleatorio si quieres usar API admin por header.
- `BILLING_MODE=payment` o `manual` en producción.
- `SEED_DEMO=false` en producción.

## Deploy

1. Crea un PostgreSQL en Render.
2. Crea un Web Service Node y sube este ZIP o conecta el repositorio.
3. Build command: `npm ci`
4. Start command: `npm start`
5. Configura las variables anteriores.
6. En `CORS_ORIGINS`, usa exactamente la URL pública de tu servicio Render.

## Cambios de seguridad aplicados

- Ya no se sirve el directorio raíz completo; solo HTML/rutas públicas, `app.js`, `styles.css` y `/assets`.
- Se retiraron `.env`, SQLite, `node_modules` y archivos `__MACOSX` del paquete final.
- PostgreSQL se activa automáticamente cuando existe `DATABASE_URL`.
- Las credenciales admin por defecto fueron eliminadas.
- Las sesiones admin tienen expiración.
- CORS en producción exige allowlist.
- Se añadieron cabeceras de seguridad y CSP básica.
- La subida de documentos valida tipo MIME y firma/magic bytes.
- La data demo ya no se siembra automáticamente; requiere `SEED_DEMO=true`.
