# Reglas de negocio ChoferLink

## Planes

ChoferLink tiene solo dos planes de empresa:

### Free
- Costo: $0 CLP.
- Puede explorar perfiles con datos protegidos.
- Puede publicar ofertas si la empresa está verificada.
- No puede ver WhatsApp, email, RUT, patente completa ni documentos.
- No puede guardar favoritos.
- No puede guardar búsquedas.
- No puede usar matches automáticos.
- La búsqueda de perfiles queda limitada a 20 resultados por página y sin orden comercial por ranking.

### Pagado
- Costo: 0,5 UF mensual.
- Vigencia: 30 días.
- Renovación: automática cada 30 días mientras no esté cancelado.
- Cancelación: en cualquier momento, manteniendo beneficios hasta el fin del período ya contratado.
- Requiere empresa verificada para desbloquear datos sensibles.
- Permite WhatsApp, email, RUT, patentes completas, favoritos, búsquedas guardadas, matches y flujo de contacto avanzado.

## Suscripción

Campos relevantes en `companies`:

- `plan`: `free` o `paid`.
- `subscription_started_at`: inicio del período pagado.
- `subscription_ends_at`: fin del período vigente.
- `cancel_at_period_end`: si es `1`, no renueva y baja a Free al vencer.

La suscripción se refresca al cargar empresa por sesión o consultar estado. Si vence:

- Si `cancel_at_period_end = 1`, baja a Free.
- Si `cancel_at_period_end = 0`, renueva por bloques de 30 días.

Endpoint de estado:

- `GET /api/company-subscription`

## Verificación de empresa

Empresa verificada puede:

- Publicar ofertas.
- Gestionar postulaciones básicas: `nuevo`, `descartado`, `cerrado`.

Empresa verificada + plan Pagado activo puede:

- Desbloquear datos sensibles.
- Contactar perfiles.
- Guardar favoritos.
- Usar matches.
- Cambiar postulaciones a estados de contacto: `contactado`, `entrevista`, `contratado`.
- Evaluar perfiles con postulación válida.

## Visibilidad de perfiles

Sin acceso Pagado verificado:

- Nombre parcial.
- Comuna protegida.
- RUT/email/WhatsApp ocultos.
- Patente y datos vehiculares sensibles ocultos.
- Descripción recortada.
- Rutas protegidas.

Con acceso Pagado verificado:

- Perfil completo.
- Datos de contacto.
- RUT.
- Patente y datos vehiculares.

## Postulaciones

Estados permitidos:

- `nuevo`: postulación recibida.
- `contactado`: empresa contactó al trabajador.
- `entrevista`: proceso en entrevista.
- `contratado`: trabajador contratado.
- `descartado`: empresa descartó la postulación.
- `cerrado`: proceso cerrado sin nueva gestión.
- `retirada`: trabajador retiró la postulación.

Reglas:

- Trabajador puede retirar una postulación mientras no esté `contratado` ni `cerrado`.
- Empresa no puede cambiar una postulación `retirada`.
- Estados `contactado`, `entrevista` y `contratado` requieren empresa verificada + Pagado.
- Estados `descartado` y `cerrado` requieren empresa verificada.

## Evaluaciones

Una empresa puede evaluar un perfil solo si:

- Está verificada.
- Tiene plan Pagado activo.
- Existe una postulación con estado `contactado`, `entrevista` o `contratado`.

Un trabajador puede evaluar una empresa solo si existe una postulación propia en estado `contactado`, `entrevista` o `contratado`.

## Pantalla de suscripción

La empresa autenticada puede revisar su estado comercial en `/empresa/suscripcion`.

La pantalla muestra:
- plan actual (`Free` o `Pagado`),
- precio del plan pagado (`0,5 UF/mes`),
- inicio del período,
- fin de beneficios,
- próximo cobro si la renovación automática está activa,
- estado de cancelación al final del período,
- permisos habilitados o bloqueados.

La cancelación no elimina beneficios inmediatamente: marca `cancel_at_period_end=1` y mantiene acceso pagado hasta `subscription_ends_at`.

## Pago real vs modo demo

En producción, el backend no debe activar `paid` directamente desde `/api/company-plan`.

Reglas actuales:

- `POST /api/company-plan` con `plan=paid` solo activa el plan si está habilitado el modo demo.
- Modo demo permitido solo cuando:
  - `BILLING_MODE=demo`, o
  - `ALLOW_DEMO_BILLING=true`, o
  - `NODE_ENV` no es `production`.
- En producción, si no hay demo habilitado, responde `402 payment_required`.
- Si existe `PAYMENT_CHECKOUT_URL`, el frontend redirige a esa pasarela.
- Si no existe pasarela configurada, muestra mensaje de activación pendiente.
- La cancelación (`plan=free` o `/api/company-plan/cancel`) sigue disponible para empresas autenticadas y respeta el período vigente.

Variables sugeridas:

```env
NODE_ENV=production
BILLING_MODE=payment
PAYMENT_CHECKOUT_URL=https://tu-pasarela.example/checkout/choferlink-paid
```

Para demo local:

```env
NODE_ENV=development
BILLING_MODE=demo
```


## Límite de ofertas Free

- Empresas verificadas en plan Free pueden mantener como máximo 1 oferta abierta simultánea.
- Para publicar más ofertas abiertas deben pausar/cerrar una existente o activar el plan Pagado.
- El límite se puede ajustar con `FREE_ACTIVE_JOBS_LIMIT`, por defecto `1`.

## Activación de pago real

- En producción, `/api/company-plan` no activa Pagado directamente.
- La pasarela debe redirigir usando `PAYMENT_CHECKOUT_URL` y confirmar pago mediante `POST /api/billing/webhook`.
- El webhook requiere header `x-payment-webhook-secret` o `x-webhook-secret` igual a `PAYMENT_WEBHOOK_SECRET`.
- Payload mínimo aceptado: `{ "company_id": 123, "status": "paid" }` o `{ "email": "empresa@dominio.cl", "status": "paid" }`.
