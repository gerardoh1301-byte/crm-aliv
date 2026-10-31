# Sistema integrado Aliv Perú

Versión sin costos adicionales del "sistema de IA que reemplaza un equipo de marketing", adaptada a pago contra entrega en Perú y sin llamadas de voz. **Propone y mide; Gerardo aprueba.**

```
Clientes ──► WhatsApp / Instagram ──► CRM (Render, 24/7, bot con Gemini)
                                          │  pedidos por chat, anuncio de origen,
                                          │  confirmación de pedidos web, alertas
                                          ▼
Meta Ads ──┐                       /api/metricas
Shopify ───┼──► Claude en la nube (7:07) ──► Hoja "Sistema integrado Aliv Perú"
CRM ───────┘     panel → director              Resumen · Diario · Anuncios · Pedidos
                 optimizador (L-M-V)           Salud_CRM · Decisiones_pago
                 radar (lunes)                 Aprobaciones · Competencia · Config
                                                    │
                                     Gerardo aprueba ┘──► Claude en la PC aplica
```

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `reglas-comerciales.md` | **Fuente única** de precios, condiciones y salud, para el bot y las skills |
| `decisiones-pago.md` | Qué servicio pagar y con qué medida decidirlo |
| `configuracion.md` | Datos del sistema y **checklist de lo que falta hacer** |
| `tareas-nube.md` | Las 3 tareas programadas (prompts, horarios, entorno) |
| `crm/CAMBIOS-CRM.md` | Qué cambió en el CRM, cómo fusionarlo y qué verifiqué |
| `crm/boton-confirmar-easysell.md` | Confirmación de pedidos sin pagar plantillas |
| `skills/panel-crecimiento` | Meta + Shopify + CRM → hoja (script `consolidar.py`, estructura `hoja_inicial.py`) |
| `skills/director-crecimiento` | Alertas, lectura del día, propuestas y "aplica las aprobadas" |
| `skills/optimizador-presupuesto` | Reparto del presupuesto dentro del tope (solo propone) |
| `skills/radar-competencia` | Biblioteca de anuncios semanal |
| `scripts/publicar_en_repo.py` | Copia las skills y las reglas al repo del CRM para que las tareas en la nube las usen |

## Cómo se relaciona con tus otras skills

- `aliv-peru-ecommerce`: sigue siendo la operación diaria (tienda, campañas, WhatsApp). Sus reglas comerciales ahora apuntan aquí.
- `creacion-videos-*` y `creativos-campanas`: reciben como brief las variantes que pida el optimizador y los ángulos del radar.
- `buscador-productos-peru`: sus productos nuevos se agregan a los términos del radar.

## Cambiar algo

- **Precios o políticas:** `reglas-comerciales.md` + el prompt del bot (`config/plantillas/ecommerce.ts` del CRM).
- **Umbrales:** pestaña **Config** de la hoja (no hay umbrales escondidos en scripts).
- **Skills:** edítalas aquí y corre `python scripts/publicar_en_repo.py <ruta del repo crm-aliv>` para que la nube use la versión nueva.
