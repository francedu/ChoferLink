# Notificaciones administrativas por email

Esta versión agrega mensajería por correo para facilitar la revisión documental y la validación de accesos.

## Variables de entorno

Configura al menos una de estas variables en Render:

```env
ADMIN_NOTIFY_EMAILS=admin@tudominio.cl,otro@tudominio.cl
```

Si `ADMIN_NOTIFY_EMAILS` no está definida, el sistema usa `ADMIN_EMAIL` como destinatario de notificaciones.

Debe estar configurado el proveedor de email que ya usas:

```env
EMAIL_DELIVERY=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=appchoferlink@gmail.com
SMTP_PASSWORD=tu_app_password
SMTP_FROM=ChoferLink <appchoferlink@gmail.com>
```

## Emails que se envían

### Al admin

- Nueva empresa registrada con documento de verificación.
- Nuevo perfil registrado con documentos de conductor.

Cada correo incluye datos básicos y enlace directo al panel admin.

### Al usuario

- Empresa aprobada o no verificada.
- Perfil/documentos aprobados o rechazados/pendientes.

## Trazabilidad

Se agregan eventos de auditoría:

- `admin_email_new_company_sent`
- `admin_email_new_profile_sent`
- `admin_company_verification_changed`
- `admin_profile_verification_changed`
- `operational_email_failed`

## Campos nuevos de revisión

El sistema agrega automáticamente si no existen:

- `companies.verification_reviewed_at`
- `companies.verification_review_notes`
- `profiles.document_reviewed_at`
- `profiles.document_review_notes`

## Seguridad operacional

Si un email administrativo falla, el registro o la aprobación no se bloquean. El fallo queda registrado en logs/eventos para revisión.
