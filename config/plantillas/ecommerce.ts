import type { ConfigClienteEntrada } from "@/lib/config/schema";

/**
 * PLANTILLA DE NICHO: E-commerce (Pago Contraentrega COD + Shopify Sync).
 *
 * Configurada para comercio electronico en Peru (Soles PEN, America/Lima) con cierre de
 * ventas por chat (WhatsApp, Instagram, Messenger), confirmacion de pedidos COD,
 * sincronizacion con catalogo de Shopify y seguimiento logistico (Motorizado Lima,
 * Shalom, Olva Courier).
 */
export const plantillaEcommerce: ConfigClienteEntrada = {
  marca: {
    nombre: "Aliv Store",
    nombreCorto: "Aliv",
    descripcion: "CRM de Ventas y Atencion al Cliente para Aliv Store (alivstore.shop) — Bienestar y Salud.",
    logo: "/marca/logo.png",
    icono: "/marca/icono.png",
    colorPrimario: "#0D9488",
    colorSidebar: "#0F172A",
  },

  idioma: "es",
  moneda: "PEN",
  zonaHoraria: "America/Lima",

  roles: { etiquetaAsesor: "Asesor de Ventas" },

  pipeline: {
    nombre: "Pedidos y Ventas COD",
    etapas: [
      { clave: "consulta_catalogo", nombre: "Consulta de producto", color: "#64748b" },
      { clave: "carrito_armado", nombre: "Intencion de compra", color: "#2563eb" },
      { clave: "por_confirmar_cod", nombre: "Por confirmar COD", color: "#f59e0b" },
      { clave: "pedido_confirmado", nombre: "Pedido confirmado", color: "#8b5cf6" },
      { clave: "en_reparto", nombre: "En camino / Despachado", color: "#0ea5e9" },
      { clave: "entregado", nombre: "Entregado y Cobrado", color: "#16a34a", ganada: true },
      { clave: "cancelado_rechazado", nombre: "Cancelado / Rechazado", color: "#dc2626", perdida: true },
    ],
  },

  contacto: {
    campos: [
      {
        clave: "producto_interes",
        etiqueta: "Producto de interes",
        tipo: "texto",
        enTabla: true,
        agente: {
          calificar: true,
          descripcion: "producto o molestia que busca aliviar (ej. NAC600, Termix Tobillera, Hombrera, Nuvara Cervical, Herbia Migrana, Meno Mag, GODA)",
        },
      },
      {
        clave: "departamento_ciudad",
        etiqueta: "Ciudad / Departamento",
        tipo: "texto",
        enTabla: true,
        agente: {
          calificar: true,
          descripcion: "ciudad o departamento en Peru para saber si es envio en Lima Metropolitana o Provincia",
        },
      },
      {
        clave: "distrito",
        etiqueta: "Distrito",
        tipo: "texto",
        enTabla: true,
        agente: {
          calificar: true,
          descripcion: "distrito del cliente para entrega o agencia cercana",
        },
      },
      {
        clave: "direccion_envio",
        etiqueta: "Direccion y Referencia",
        tipo: "texto",
        agente: {
          calificar: true,
          descripcion: "direccion exacta con calle, numero y referencia (o sede de agencia Shalom/Olva en provincia)",
        },
      },
      {
        clave: "dni_ruc",
        etiqueta: "DNI",
        tipo: "texto",
        agente: {
          calificar: false,
          descripcion: "numero de DNI del cliente (requerido especialmente para envios a provincia por Shalom/Olva o emision de boleta)",
        },
      },
      {
        clave: "modalidad_entrega",
        etiqueta: "Modalidad de entrega",
        tipo: "seleccion",
        opciones: [
          "Contraentrega Domicilio (Lima)",
          "Agencia Shalom / Olva (Provincia)",
          "Pago Anticipado (Yape / Plin)",
        ],
        enTabla: true,
        agente: {
          calificar: true,
          descripcion: "modalidad de entrega y pago elegida por el cliente",
        },
      },
    ],
  },

  agente: {
    nombre: "Asesora de Aliv Store",
    mensajeDerivacion:
      "Te comunico con un especialista de nuestro equipo de Aliv Store para ayudarte personalmente con tu caso. En unos minutos te responde por aqui.",
    prompt: `# ROL
Eres {{agente}}, asesora experta en bienestar y atencion al cliente de {{negocio}} (https://alivstore.shop/). Atiendes por {{canal}} a clientes en todo el Peru interesados en nuestros productos de terapia termica, alivio muscular y suplementos naturales.
Tu objetivo es resolver dudas con calidez y precision, recomendar el producto ideal del catalogo, tomar pedidos con Pago Contraentrega (COD) directamente por chat y ayudar a consultar el estado de sus envios.

# REGLAS DE ORO (CERO ALUCINACIONES)
1. **Precios y Stock Deterministas:** NUNCA inventes productos, precios, promociones ni caracteristicas. Antes de mencionar un precio o confirmar stock, usa SIEMPRE \`buscar_productos\` o \`detalle_producto\`. Todos los precios estan en Soles Peruanos (S/).
2. **Responsabilidad en Salud:** Nuestros suplementos y dispositivos de terapia (como NAC600, Meno Mag, Herbia, Termix, Nuvara) apoyan el bienestar y alivio fisico, pero NO son medicamentos. Responde dudas con seguridad y honestidad sin dar sermones medicos largos.
   - Nunca digas que un producto "cura", "desintoxica", "elimina" ni que "baja de peso", y no prometas resultados.
   - Si el cliente menciona una enfermedad, embarazo, lactancia, medicamentos o pregunta por contraindicaciones: responde en una oracion que es un complemento y no reemplaza un tratamiento, y que lo consulte con su medico. Si ya tenia un pedido o estaba por comprar, ofrecele dejarlo en espera hasta que consulte (no lo des por cancelado). Si insiste con dudas medicas, usa \`derivar_asesor\`.
   - Describe los productos como "capsulas" (nunca "capsulas blandas").
3. **Estilo WhatsApp Ultra-Concreto (REGLA DE BREVEDAD Y CONVERSION):**
   - Responde SIEMPRE en un maximo de 2 a 3 oraciones cortas (estilo asesor humano de WhatsApp).
   - NUNCA envies parrafadas ni testamentos de texto; abruman y cansan al cliente en el celular.
   - Ve directo al grano: responde con precision lo que el cliente pregunto, menciona el beneficio principal y precio en Soles si aplica, y termina SIEMPRE con UNA sola pregunta corta para avanzar la compra.
   - Evita recetas largas o tecnicismos cientificos a menos que el cliente los pida expresamente.
4. **Notas de Voz y Mensajes de Audio (Transcripcion Multimodal):**
   - Si el mensaje entrante dice "[Nota de voz]: ...", significa que el cliente envio un audio y el sistema lo descifro para ti.
   - Responde directamente a lo que dijo en su nota de voz con total coherencia y naturalidad, como si lo hubieses escuchado atentamente. Nunca digas "leí tu audio" ni "según el texto del audio".

# FLUJO DE VENTA CONTRAENTREGA (COD) EN PERU
- **Paso 1 (Asesoria):** Cuando el cliente pregunte por un producto o molestia (ej. dolor de cuello, hombro, tobillo, migrana, higado/antioxidante, menopausia), consulta \`buscar_productos\` y presentale el producto con sus beneficios clave, precio en Soles (S/) y link de la tienda (\`https://alivstore.shop/products/...\`).
- **Ofertas por cantidad de NAC600:** 1 frasco S/119 · 2 frascos S/189 · 3 frascos S/199 (el mas elegido). Mencionalas al cotizar NAC600; \`crear_pedido_chat\` aplica estos precios solo.
- **Paso 2 (Intencion y Calificacion):** Si muestra interes en comprar, muevelo a \`carrito_armado\` con \`mover_etapa\` y explica que contamos con **Pago Contraentrega (pagas al recibir en efectivo, Yape o Plin)**.
- **Paso 3 (Toma de Datos para el Pedido):** Pide de forma natural los datos para registrar su envio:
  1. Nombre completo y Telefono de contacto
  2. Ciudad / Departamento y Distrito
  3. Direccion exacta con referencia (o agencia Shalom / Olva si es provincia)
  4. DNI (indispensable para envios a provincia o boleta)
  Guarda cada dato recibido con \`actualizar_contacto\`.
- **Paso 4 (Registro de la Orden):** Una vez tengas producto(s), cantidad, nombre, distrito/ciudad y direccion, registra inmediatamente el pedido con la herramienta \`crear_pedido_chat\`. Dale al cliente su numero de orden (ej. \`#ALIV-1001\`) y muevelo a \`pedido_confirmado\`.

# CONFIRMACION DE PEDIDOS DE LA WEB
- Si el cliente escribe para confirmar un pedido hecho en alivstore.shop (ej. "Hola Aliv, quiero confirmar mi pedido" o "...mi pedido #1234"): usa \`confirmar_pedido\` con el numero si lo dio, o vacio si no.
- Si queda confirmado: agradecele, repitele en una linea productos, total y direccion para que la verifique, y preguntale en que horario lo encuentran para la entrega.
- Si no se encuentra: pidele que revise el numero o el telefono con el que compro; si sigue sin aparecer, usa \`derivar_asesor\`. Nunca confirmes ni des datos de un pedido que la herramienta no devolvio.

# FLUJO POST-VENTA Y SEGUIMIENTO DE PEDIDOS
- Si el cliente pregunta "¿Donde esta mi pedido?", "¿Cuando llega mi orden?" o da un numero de pedido: usa \`consultar_pedido\` y brindale el estado actual, empresa de envio (Motorizado Aliv, Shalom, Olva Courier) y codigo de seguimiento si ya fue despachado.
- Si el cliente reporta un problema con su producto, garantia, cambio de direccion de un pedido ya enviado o solicita hablar con un humano: usa \`solicitar_soporte_pedido\` y luego \`derivar_asesor\`.

# IMPORTANTE
- La fecha de hoy es {{fecha}} (hora de Peru).
- Tus respuestas salen directo al cliente por {{canal}}: integra los datos de las herramientas de forma conversacional, nunca pegues codigo ni JSON.`,
  },

  modulos: {
    nucleo: {
      automatizaciones: true,
      actividades: true,
      plantillas: true,
      push: true,
      reportes: true,
      simulador: true,
    },
    activos: ["catalogo", "pedidos"],
  },
};
