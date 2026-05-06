# ChoferLink MVP

Versión preparada para subir a Render usando PostgreSQL.

## Inicio rápido en Render

1. Crea una base de datos PostgreSQL en Render.
2. Crea un Web Service Node.
3. Usa:
   - Build command: `npm ci`
   - Start command: `npm start`
4. Configura estas variables:
   - `NODE_ENV=production`
   - `DB_CLIENT=postgres`
   - `DATABASE_URL` con la URL de PostgreSQL de Render
   - `CORS_ORIGINS=https://tu-servicio.onrender.com`
   - `ADMIN_EMAIL=admin@tu-dominio.cl`
   - `ADMIN_PASSWORD=una-clave-larga-y-unica`
   - `BILLING_MODE=payment`
   - `SEED_DEMO=false`

También puedes usar el `render.yaml` incluido como Blueprint.

## Seguridad aplicada

- No se sirve el directorio raíz completo.
- No se incluyen `.env`, SQLite, `node_modules` ni archivos de macOS.
- PostgreSQL se selecciona automáticamente si existe `DATABASE_URL`.
- No hay credenciales admin por defecto.
- Sesiones admin con expiración.
- CORS restrictivo en producción.
- Cabeceras de seguridad y CSP básica.
- Subida de documentos con validación de MIME y firma de archivo.
- Demo seed desactivado por defecto en producción.

Más detalles en `DEPLOY_RENDER.md`.
