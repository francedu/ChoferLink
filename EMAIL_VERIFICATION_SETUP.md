# Verificación de email en ChoferLink

Esta versión exige confirmar el correo antes de iniciar sesión o usar una cuenta registrada.

## Variables en Render

Para envío real con Resend:

```env
PUBLIC_BASE_URL=https://choferlink.onrender.com
EMAIL_DELIVERY=resend
RESEND_API_KEY=tu_api_key_de_resend
EMAIL_FROM=ChoferLink <no-reply@tu-dominio.cl>
```

Para pruebas sin proveedor de correo:

```env
PUBLIC_BASE_URL=https://choferlink.onrender.com
EMAIL_DELIVERY=console
```

En modo `console`, el enlace de verificación aparece en los logs de Render como `EMAIL_VERIFICATION_LINK`.

## Flujo implementado

1. Al registrar empresa o perfil se crea un token seguro.
2. El token se guarda hasheado en base de datos.
3. El enlace vence en 24 horas.
4. El usuario debe entrar a `/api/email/verify?token=...`.
5. Después de verificar, puede iniciar sesión y usar la cuenta.
6. Si no llega el correo, puede reenviar desde `/api/email/resend` o desde el login empresa.

## Seguridad

- No se guarda el token en texto plano.
- Tokens expiran en 24 horas.
- Reenvío limitado por IP.
- Cuentas no verificadas no pueden iniciar sesión ni usar endpoints protegidos.
