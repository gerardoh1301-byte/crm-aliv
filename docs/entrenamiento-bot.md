# Entrenamiento del bot vendedor

Plan aplicado el 19/11/2026 a partir de 164 chats reales de WhatsApp (12 al 19/11).

## Lo que mostraron los datos

- De 164 chats: 49 terminaron en pedido, 19 nunca respondieron y 94 se enfriaron después de un mensaje nuestro. El cliente escribe en promedio solo 2 mensajes.
- Primer mensaje del bot de menos de 350 caracteres: 70 % siguen la conversación y 39 % terminan en pedido. De más de 700 caracteres: 9 %. Es una correlación (los que llegan por anuncio recibían el folleto largo); la prueba A/B lo confirma o lo descarta.
- 2 de cada 3 primeras respuestas no terminaban en pregunta.
- El bot responde rápido: de 497 respuestas solo 33 tardaron más de 5 minutos, y casi todas eran de un asesor.

## Qué cambió

| Paso | Dónde |
|---|---|
| 1. Prueba A/B del primer mensaje (B = corto, ≤ 350 caracteres) | `src/lib/agent/guion-venta.ts`, variable `AB_PRIMER_MENSAJE` |
| 2. Banco de respuestas que cierran | `config/ejemplos-venta.ts` |
| 3. Guion por etapa con 2–3 ejemplos al final del prompt | `src/lib/agent/guion-venta.ts` |
| 4. Provincia en orden: agencia → adelanto → DNI; cotización corta | `config/plantillas/ecommerce.ts` |
| 5. Seguimiento con hora ("en 20 min te paso los datos") y nombres limpios | `src/lib/agent/seguimiento*.ts`, `src/lib/nombres.ts` |
| 6. Evaluador con 12 clientes simulados | `scripts/evaluar-bot.mjs` |
| 7. Embudo y resultado A/B en el panel diario | `embudo_chat` en `/api/metricas` |
| 8. El filtro de "pedido inexistente" ya no corta ventas normales | `src/lib/agent/guardrail-orden.ts` |

## Cómo seguir entrenándolo (cada semana)

1. Lee 10 chats que se enfriaron. Para cada uno, escribe la respuesta que habría cerrado la venta.
2. Agrégala a `config/ejemplos-venta.ts` con su etapa y situación (`origen: "real"` si salió de un chat ganador). Máximo 4 líneas, termina en una propuesta, precios oficiales, sin devolución por satisfacción, sin efectivo ni tarjeta.
3. Corre las pruebas (`npm test`) y el evaluador contra un CRM local:
   ```
   npm run local -- --puerto 3007
   node scripts/evaluar-bot.mjs --base http://localhost:3007 --pin <ADMIN_PIN>
   ```
   Si sale con código 1, alguna respuesta rompió una regla dura: corrígela antes de desplegar.
4. Despliega y mira `embudo_chat` en el panel diario.

## Prueba A/B

- `AB_PRIMER_MENSAJE=on` (por defecto): mitad A, mitad B, fijo por conversación.
- Decide con al menos ~150 chats por variante (unas 2 semanas). Compara `conversion_pct` de A y B.
- Si gana B: `AB_PRIMER_MENSAJE=B` en Render. Si gana A: `AB_PRIMER_MENSAJE=off`.

## Pendiente que no es código

- Respaldo pagado de IA (OpenRouter con saldo) para cuando Gemini se cae: hoy, si Gemini falla del todo, el cliente se queda sin respuesta.
- Revisar y mejorar los ejemplos marcados `origen: "modelo"` con la voz de tu mejor asesor.
