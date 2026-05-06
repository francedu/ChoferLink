# Configuración Flow.cl para ChoferLink

Esta versión incluye integración inicial con Flow para activar el plan Pagado por 30 días.

## Variables en Render

Configura estas variables en el Web Service:

```env
BILLING_MODE=payment
FLOW_API_KEY=tu_api_key_flow
FLOW_SECRET_KEY=tu_secret_key_flow
FLOW_BASE_URL=https://sandbox.flow.cl/api
PUBLIC_APP_URL=https://choferlink.onrender.com
FLOW_RETURN_URL=https://choferlink.onrender.com/api/payments/flow/return
FLOW_CONFIRM_URL=https://choferlink.onrender.com/api/payments/flow/confirm
PLAN_PAID_AMOUNT_CLP=19990
```

Para producción cambia:

```env
FLOW_BASE_URL=https://www.flow.cl/api
```

## Flujo implementado

1. Empresa verificada entra a Suscripción.
2. Presiona Activar Pagado.
3. El backend crea una orden en Flow `/payment/create`.
4. Flow redirige al checkout.
5. Flow confirma a `/api/payments/flow/confirm`.
6. El backend consulta `/payment/getStatus`.
7. Si el pago está aprobado, activa `plan='paid'` por 30 días.

## Importante

- Solo empresas verificadas pueden iniciar el pago.
- El redirect no activa el plan por sí solo; siempre se valida el estado real contra Flow.
- El monto se controla con `PLAN_PAID_AMOUNT_CLP`.
