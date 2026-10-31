# Botón "Confirmar por WhatsApp" (confirmación sin costo)

**Idea:** que el cliente escriba **él primero** después de comprar. Así la respuesta del bot cae en la ventana gratuita de 24 h de WhatsApp y no se paga plantilla. Además confirma en caliente, en el minuto 1, que es cuando más confirma (`rentabilidad.md`: contactar en los primeros 15 minutos).

## Enlace

```
https://wa.me/51944392731?text=Hola%20Aliv%2C%20quiero%20confirmar%20mi%20pedido
```

Si EasySell permite insertar el número del pedido en el texto (busca en su configuración una variable tipo `{order_number}` o `{{order.name}}`), úsalo:

```
https://wa.me/51944392731?text=Hola%20Aliv%2C%20quiero%20confirmar%20mi%20pedido%20%23{order_number}
```

**No es obligatorio:** el bot confirma también sin número. Busca el pedido pendiente más reciente del mismo teléfono (`confirmar_pedido` en el CRM).

## Dónde ponerlo (en este orden de preferencia)

1. **EasySell → formulario → página de gracias / mensaje posterior al pedido:** un botón verde "✅ Confirmar mi pedido por WhatsApp" con el enlace.
2. **EasySell → redirección después del pedido:** algunas versiones permiten redirigir a una URL. Redirigir directo a WhatsApp es más agresivo; prueba primero el botón.
3. **Página de estado del pedido de Shopify** (Configuración → Pagos/Checkout → personalizar la página de pedido): un bloque de texto con el enlace.

Texto sugerido junto al botón:
> 📲 **Último paso:** confirma tu pedido por WhatsApp y coordinamos la entrega. Toma 10 segundos.

## Cómo saber si funciona

En la hoja, *Decisiones_pago* → fila "Plantillas WhatsApp": el % de pedidos web que siguen por confirmar. Si después de una semana con el botón sigue en 50 % o más, la hoja marca **PAGAR**: ahí conviene que el CRM escriba primero con una plantilla (~S/0,10 por mensaje).

## Ojo

- Es un cambio en la tienda en vivo: hazlo tú o pídeselo a Claude en una sesión aparte, con la skill `aliv-peru-ecommerce` (`tienda-shopify.md`).
- El número es el de WhatsApp Business de Aliv (`+51 944 392 731`). Si algún día cambia, actualiza este enlace.
