# Verificación de email en ChoferLink

## Variables en Render para Gmail SMTP

Configura estas variables en tu Web Service:

```env
APP_BASE_URL=https://choferlink.onrender.com
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_DELIVERY=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu_correo@gmail.com
SMTP_PASS=tu_app_password_sin_espacios
SMTP_FROM=ChoferLink <tu_correo@gmail.com>
```

Para Gmail debes usar contraseña de aplicación. Si Google muestra la clave con espacios, guárdala en Render sin espacios.

Después de cambiar variables:

```text
Manual Deploy → Clear build cache & deploy
```

## Cómo probar

1. Registra una empresa nueva o perfil nuevo.
2. En Logs de Render debe aparecer:

```text
Attempting email verification delivery to correo@dominio.com
Email verification sent via SMTP to correo@dominio.com
```

3. El usuario recibe un enlace como `/api/email/verify?token=...`.

## Modo diagnóstico

Para ver el link en logs sin enviar correo:

```env
EMAIL_DELIVERY=console
```

Luego registra una cuenta y busca en Logs:

```text
EMAIL_VERIFICATION_LINK
```
