# Reglas comerciales de Aliv Perú (fuente única)

Este archivo manda sobre cualquier otro texto con precios, condiciones o política de salud. Lo leen:
- el **bot del CRM** (su prompt está en `config/plantillas/ecommerce.ts` del repo `crm-aliv`, y los precios por cantidad en `modules/pedidos/servidor.tsx`);
- las **skills de Claude** (`aliv-peru-ecommerce`, las del sistema integrado y las de creativos);
- cualquier persona que responda chats.

**Si cambias algo aquí, cámbialo también en el prompt del bot.** Si en el CRM hay un prompt guardado en *Ajustes → Agente IA*, ese reemplaza al del código: pega allí los mismos cambios.

Última revisión: 31/10/2026.

## Productos y precios

| Producto | Precio | Ofertas | Página |
|---|---|---|---|
| **NAC600** (NAC 600 mg + NAD+, 60 cápsulas, 2 al día con el desayuno, 1 frasco = 30 días) | S/119 | 2 frascos **S/189** · 3 frascos **S/199** (el más elegido). Más de 3: paquetes de 3 + el resto | alivstore.shop/products/nac600 |
| **Termix Tobillera** (calor + masaje, grafeno, USB-C) | S/99 | Una sola presentación | alivstore.shop/products/termix-tobillera |
| **Termix Hombrera** | S/99 | — | en la tienda |

- Se dice **"cápsulas"**, nunca "cápsulas blandas".
- Sin olor ni sabor a azufre (va en aceite MCT).
- El catálogo con precio y stock vive en Shopify. El CRM lo copia en `modules/catalogo/productos-aliv.ts`; si cambia un precio, actualiza los dos.

## Condiciones de venta

- **Envío gratis** a todo el Perú.
- **Garantía de 30 días.**
- **Lima Metropolitana y Callao:** pago contra entrega (efectivo, Yape o Plin al recibir).
- **Provincia:** ⚠️ **HAY DOS VERSIONES Y FALTA QUE DECIDAS UNA**:
  - Skill de Claude (`pedidos-whatsapp.md`, regla fijada el ~20/10): *"es necesario un adelanto de S/20"*; el saldo se paga al recibir. Sin número de Yape ni titular salvo que tú los des.
  - Bot del CRM (27–28/10): envío por agencia **Shalom / Olva** con DNI, sin mencionar el adelanto.
  - Hasta que decidas, el bot sigue como está. Cuando elijas, actualiza esta sección y el paso 3 del prompt del bot.

## Salud (no negociable)

- **Nunca** decir que un producto "cura", "desintoxica", "elimina" o "baja de peso". Nada de antes/después ni de mencionar la condición del lector ("tu hígado graso").
- Preferir: "apoya", "ayuda a tu cuerpo a producir glutatión", pago contra entrega, envío gratis, garantía.
- Si alguien menciona **enfermedad, embarazo, lactancia, medicamentos o contraindicaciones**: es un complemento, no reemplaza un tratamiento, que lo consulte con su médico. El pedido queda **en espera, no cancelado**, con **un solo** seguimiento a las 48–72 h. Texto completo en `aliv-peru-ecommerce/references/whatsapp-business.md` (/salud y /espera).
- **Testimonios:** nunca inventarlos ni usar "clientes" generados con IA como si fueran reales.

## Confirmación de pedidos web (sin costo)

- El cliente confirma escribiendo **él primero** por WhatsApp desde el botón de la página de gracias (ver `crm/boton-confirmar-easysell.md`). Así la respuesta del bot cae en la ventana gratuita de 24 h.
- El bot usa la herramienta `confirmar_pedido`, que solo encuentra pedidos con el **mismo teléfono** del chat.
- Escribirle tú primero al cliente usa una **plantilla pagada** de Meta (~S/0,10 por mensaje). Por ahora no se usa: ver `decisiones-pago.md`.

## Dinero y aprobaciones

- **Activar campañas, subir presupuesto o gastar dinero requiere el "sí" explícito de Gerardo en la conversación.** Ninguna tarea programada lo hace sola: solo propone en la pestaña *Aprobaciones* de la hoja.
- Pausar por una regla que él definió sí está autorizado.
- Margen objetivo: **~60 %** en fabricación local (NAC600) y **~30 %** en importados (Termix). Los umbrales de CPA salen de `aliv-peru-ecommerce/scripts/rentabilidad.py`.
