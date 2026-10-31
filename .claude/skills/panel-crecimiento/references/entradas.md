# Entradas de consolidar.py

Los cuatro archivos van en la carpeta de la corrida. Montos en soles (PEN), sin datos personales.

## meta.json

```json
{"anuncios": [
  {"ad_id": "120250443877100789", "anuncio": "AD - 05 NAC600-5",
   "campana": "20.10.2026 I Test Creativos I NAC600 I ABO I S/.30",
   "gasto": 32.72, "impresiones": 1400, "clics": 50, "compras_pixel": 4}
]}
```

| Campo | De `ads_get_ad_entities` |
|---|---|
| ad_id | `id` |
| anuncio | `name` |
| campana | `campaign_name` (el producto se deduce de aquí y del nombre: NAC → NAC600; TERMIX/TOBILLERA/HOMBRERA → TERMIX) |
| gasto | `amount_spent.value` |
| impresiones | `impressions` |
| clics | `link_click` (clics en el enlace; `null` = 0) |
| compras_pixel | `omni_purchase` (`null` = 0) |

## shopify.json

```json
{"pedidos": [
  {"numero": "#1035", "creado": "2026-10-21T05:22:34Z", "total": 199, "unidades": 3,
   "producto": "NAC600", "ciudad": "Huaura", "utm_content": "120250443877100789", "cancelado": false}
]}
```

Consulta (conector de Shopify, `graphql_query`, `first: 50`, sigue `pageInfo.endCursor` mientras `hasNextPage`):

```graphql
query($q: String) {
  orders(first: 50, sortKey: CREATED_AT, query: $q) {
    nodes {
      name createdAt cancelledAt
      totalPriceSet { shopMoney { amount } }
      customAttributes { key value }
      shippingAddress { city }
      lineItems(first: 5) { nodes { title quantity } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Variables: `{"q": "created_at:>='FECHAT05:00:00Z' created_at:<'FECHA+1T05:00:00Z'"}` (medianoche de Lima = 05:00 UTC).

| Campo | De dónde |
|---|---|
| numero | `name` |
| creado | `createdAt` |
| total | `totalPriceSet.shopMoney.amount` |
| unidades | suma de `lineItems.quantity` |
| producto | `title` de la primera línea |
| ciudad | `shippingAddress.city` |
| utm_content | el `value` del atributo con `key` = `utm_content` (vacío si no hay) |
| cancelado | `cancelledAt` no nulo |

Los atributos traen también nombre, teléfono, dirección e IP: **no los copies**.

## crm_dia.json y crm_7d.json

La respuesta tal cual de `GET /api/metricas?desde=…&hasta=…` (ver `src/lib/metricas.ts` en el repo `crm-aliv`). Ya viene sin teléfonos ni direcciones. Partes que se usan:

- `por_dia[]`: conversaciones, mensajes, respuestas del bot, derivados a una persona.
- `pedidos[]`: `origen` (`chat` | `web`), `estado`, `total`, `unidades`, `ad_id` (anuncio de origen del chat).
- `comentarios`: total, con intención de compra y quejas (`comment.received` de Zernio).
- `salud`: demora del webhook, tiempo de respuesta del bot, errores 429, trabajos atascados.
- `sin_respuesta[]`: chats cuyo último mensaje es del cliente hace más de 60 min (solo primer nombre).
