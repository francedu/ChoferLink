# Dashboard empresas + automatización parcial SII

## Dashboard empresas
La ruta `/api/company-dashboard` ahora incluye `dashboard_insights` con:

- métricas de ofertas abiertas/pausadas/cerradas
- postulaciones, contactadas y contratadas
- conversión postulación → contacto
- conversión contacto → contrato
- rendimiento por oferta
- alertas operativas
- recomendaciones de próxima acción

El panel empresa muestra estas secciones sin tocar el flujo de login.

## Automatización parcial SII
No consulta SII en línea. Es una prevalidación interna para priorizar revisión admin:

- RUT jurídico/persona jurídica
- razón social con tipo legal: SpA, Ltda., EIRL, S.A., etc.
- documento empresa cargado
- email verificado
- email no gratuito
- coherencia básica nombre comercial / razón social
- contacto y ubicación completos

El admin ve score 0-100 en **Auto-verificación SII parcial**.

Las empresas elegibles pueden ser aprobadas en lote, quedando registro en auditoría.

## Recomendación
Úsalo como apoyo operacional. Para validación tributaria real, integrar una API/proveedor de datos SII cuando esté disponible.
