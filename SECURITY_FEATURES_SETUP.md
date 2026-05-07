# ChoferLink - mejoras de seguridad y operación

Incluye:

## Recuperación de contraseña
- Página: `/recuperar`
- Solicitud: `POST /api/password/forgot`
- Reset: `/api/password/reset?token=...`
- Token aleatorio con hash SHA-256, vencimiento 24h y cierre de sesiones al cambiar contraseña.

Usa la misma configuración de email existente:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`/`SMTP_PASS`, `SMTP_FROM`
- o `EMAIL_DELIVERY=resend` + `RESEND_API_KEY`.

## Matching mejorado
- Considera necesidad de la empresa, últimos trabajos, búsquedas guardadas, región, comuna, licencia, tipo de perfil, especialidad, disponibilidad, reputación, documentación, experiencia y camión.
- Endpoint: `GET /api/recommendations?job_id=<id>&limit=15`.

## Métricas admin ampliadas
- Empresas pagadas, emails no verificados, trabajos abiertos, postulaciones últimas 24h, eventos últimas 24h, logins fallidos y alertas antifraude.
- Panel admin muestra pestañas nuevas: Antifraude y Logs.

## Logs antifraude/auditoría
- Registra altas, intentos fallidos de login, recuperación de contraseña, matches ejecutados, contactos, favoritos y otros eventos críticos.
- Endpoints admin:
  - `GET /api/admin/audit-events`
  - `GET /api/admin/fraud-signals`
