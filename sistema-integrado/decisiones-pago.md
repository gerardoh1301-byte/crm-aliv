# Qué vale la pena pagar (decisiones con datos)

La fase actual no agrega costos. Cada servicio pagado tiene una **medida** que el sistema toma gratis y un **umbral** que dice cuándo conviene pagarlo. El panel diario carga las medidas de los últimos 7 días en la pestaña **Decisiones_pago** de la hoja, y una fórmula marca el estado con los umbrales de la pestaña **Config** (celdas azules). Para cambiar un umbral, cámbialo en Config; esta tabla muestra los valores iniciales.

| Servicio | Costo aprox. | Qué se mide (7 días) | Estado |
|---|---|---|---|
| **Render Starter** (servidor siempre encendido) | ~US$7/mes | Mensajes que llegaron al CRM con más de 60 s de demora (el servidor gratis "dormido") | **PAGAR** con 3 o más · **Revisar** con 1–2 · si no, no hace falta |
| **Gemini con facturación y tope** | ~US$3–10/mes | Trabajos del bot que fallaron por límite de uso (error 429) | **PAGAR** con 1 o más · **Revisar** si hay trabajos atascados |
| **Plantillas de WhatsApp** para confirmar pedidos | ~S/0,10 por mensaje | % de pedidos web que siguen "por confirmar" | **PAGAR** con 50 % o más · **Revisar** entre 25 % y 50 % |
| **Cuentas extra de Zernio** (Facebook, TikTok) | según Zernio | Comentarios con intención de compra | **Revisar** con 20 o más |
| **ElevenLabs Starter** (voces) | US$6/mes | Prueba manual: ¿las voces de Google AI Studio sirven para 3 anuncios? | Lo marcas tú en la hoja |
| **Plan superior de Claude** | US$100/mes (Max 5x) | ¿Alguna tarea en la nube se cortó por límite de uso? | Lo marcas tú (claude.ai/settings/usage) |

## Excepción que no depende de un número: privacidad

Gemini en su **plan gratuito** usa lo que recibe para mejorar los productos de Google, y eso incluye nombres, direcciones y preguntas de salud de tus clientes. Activar la facturación con un tope lo evita. **Es una decisión tuya**, no una medida: anótala en la hoja cuando la tomes.

## Cómo se decide

1. El panel marca **PAGAR** o **Revisar** en la hoja.
2. El director lo menciona en el resumen de la mañana.
3. **Nadie contrata nada solo:** la decisión y el pago los haces tú.
