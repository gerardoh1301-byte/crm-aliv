# Regla Obligatoria: Auditoría y Revisión Periódica de Chats del CRM

## Horarios Oficiales de Auditoría Diaria (Hora de Perú UTC-5):
Todos los días en los siguientes 8 horarios exactos:
1. **05:00 a.m.** (Apertura y barrido matutino)
2. **10:00 a.m.** (Revisión de pedidos y respuestas de la mañana)
3. **01:00 p.m.** (Cierre de despacho del mediodía)
4. **04:00 p.m.** (Revisión de guías Shalom y seguimiento de la tarde)
5. **06:00 p.m.** (Cierre de agencias y verificación de despachos)
6. **08:00 p.m.** (Seguimiento nocturno de clientes y abonos)
7. **10:00 p.m.** (Barrido de clientes pendientes)
8. **11:30 p.m.** (Cierre nocturno y balance diario)

## Alcance de la Auditoría en Cada Ciclo:
En cada ejecución se debe auditar exhaustivamente:
- **Órdenes vs Chats:** Que cada chat donde se confirmó un pedido tenga su orden registrada en `pedidos_ordenes`.
- **Sincronización con Pipeline (`deals`):** Que cada orden tenga su trato en la etapa correspondiente (`por_confirmar_cod`, `agendar_entrega`, `en_reparto`, `entregado`) y que el monto coincida al centavo.
- **Etiquetas de Contacto (`tags`):** Que las etiquetas de etapa (`Orden en camino`, `Compra exitosa`, `Agendar entrega`, `Pendiente de adelanto`, etc.) reflejen la realidad operativa del chat.
- **Guías y Claves Shalom:** Que las guías (`103xxxxxx`) y claves secretas de recojo enviadas en el chat estén volcadas en la orden para seguimiento automático.
- **Atención sin abandono:** Verificar que ningún pedido nuevo o consulta de cliente haya quedado sin respuesta o plantilla dentro de su ventana.
