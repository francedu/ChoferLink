# Nuevas mejoras

## WhatsApp contacto rápido
El botón Contactar abre WhatsApp con mensaje prearmado que incluye el nombre de la empresa. Registra el evento `contact_unlocked`.

## Matching mejorado
El matching ahora usa región, comuna, licencia, tipo buscado, especialidad, disponibilidad, reputación, verificación, documentación y completitud del perfil. Devuelve `match_score`, `match_confidence`, `match_reasons` y `score_breakdown`.

## Panel admin operativo
Se agregó pestaña Auto-verificación, además de antifraude y logs.

## Auto-verificación empresa
Endpoint admin:
- `GET /api/admin/company-verification-candidates`
- `POST /api/admin/auto-verify-companies` con `{ "dry_run": false }`

Una empresa es elegible si tiene email verificado, documento cargado, RUT jurídico válido y señales de razón social/contacto.
