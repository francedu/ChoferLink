# Mejoras aplicadas sobre versión estable

Esta versión evita tocar el flujo de login/auth.

Incluye:
- WhatsApp contacto rápido con mensaje prearmado usando el nombre de la empresa.
- Tracking de aperturas de WhatsApp.
- Matching con `min_score` configurable y filtro por oferta.
- Endpoint admin de auto-verificación en modo simulación y ejecución.
- Pestaña admin “Auto-verificación”.

Auto-verificación requiere:
- email verificado,
- documento empresa cargado,
- RUT jurídico,
- razón social con tipo legal,
- región/comuna y WhatsApp.

Recomendación: primero usar “Simular”; luego “Verificar elegibles”.
