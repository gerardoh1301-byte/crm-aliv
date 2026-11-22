/**
 * Banco de respuestas que cierran (paso 2 del plan de entrenamiento del bot, 19/11/2026).
 *
 * El bot no copia estos textos: recibe 2 o 3 ejemplos parecidos a la situación del chat para
 * imitar el largo, el tono y la forma de cerrar. Por eso cada ejemplo es corto (pocas líneas)
 * y termina en una propuesta que se contesta con "sí" o con un dato.
 *
 * origen:
 * - "real": respuesta tomada de un chat que terminó en pedido (sin nombres ni teléfonos).
 * - "modelo": redactada a partir de los chats perdidos del 12 al 19/11. Revísala y cámbiala
 *   por la frase que usaría tu mejor asesor: este archivo es el lugar para "entrenar" al bot.
 *
 * Reglas para agregar ejemplos: precios oficiales, sin prometer resultados, sin devolución por
 * satisfacción (la garantía es de 30 días solo por fallas de fábrica), sin efectivo ni tarjeta.
 */

export type EtapaVenta =
  | "primer_contacto"
  | "consulta"
  | "cotizado"
  | "datos_lima"
  | "datos_provincia"
  | "adelanto"
  | "con_pedido";

export type SituacionVenta =
  | "pide_info"
  | "pide_precio"
  | "caro"
  | "lo_pienso"
  | "consulta_tercero"
  | "confianza"
  | "funciona"
  | "entrega"
  | "pago"
  | "silencio_ok"
  | "elige_pack"
  | "promete_volver"
  | "sin_dinero";

export interface EjemploVenta {
  id: string;
  etapas: EtapaVenta[];
  situacion?: SituacionVenta;
  producto?: "nac600" | "termix";
  cliente: string;
  respuesta: string;
  origen: "real" | "modelo";
}

export const EJEMPLOS_VENTA: EjemploVenta[] = [
  // ── Primer contacto (anuncio: "Quiero más información") ──────────────────────────────
  {
    id: "pc-nac-1",
    etapas: ["primer_contacto"],
    situacion: "pide_info",
    producto: "nac600",
    cliente: "¡Hola! Quiero más información",
    respuesta:
      "¡Hola, Rosa! 👋 El *NAC600 + NAD+* apoya a tu hígado y tu energía: 2 cápsulas al día, sin olor a azufre. El pack de 3 frascos (90 días) está a *S/199* con envío gratis, y en Lima pagas al recibir. ¿Es para ti o para alguien de tu familia?",
    origen: "modelo",
  },
  {
    id: "pc-termix-1",
    etapas: ["primer_contacto"],
    situacion: "pide_info",
    producto: "termix",
    cliente: "¡Hola! Quiero más información",
    respuesta:
      "¡Hola, Patty! 👋 La *Termix* da calor de grafeno y masaje para los tobillos cansados, inalámbrica y talla única. El par está a *S/139* (la más elegida para regalar) y el envío es gratis. ¿Sería para ti o para regalar?",
    origen: "modelo",
  },
  {
    id: "pc-general-real",
    etapas: ["primer_contacto"],
    situacion: "pide_info",
    cliente: "Hola Aliv Perú, quiero información",
    respuesta:
      "Tenemos el *NAC600 + NAD+* (cápsulas para energía y antioxidantes, importadas de EE. UU.) y la *Termix Tobillera* (calor de grafeno y masaje). ¿Buscas algo para tener más energía en tu día o para relajar los tobillos cansados?",
    origen: "real",
  },
  {
    id: "pc-nac-higado",
    etapas: ["primer_contacto", "consulta"],
    situacion: "pide_info",
    producto: "nac600",
    cliente: "Es para el hígado graso?",
    respuesta:
      "Sí, el NAC es precursor del glutatión, el antioxidante que usa tu hígado. Es un complemento, no reemplaza tu tratamiento. Muchos empiezan con el pack de 3 (90 días) por *S/199*. ¿Te lo envío a Lima o a provincia?",
    origen: "modelo",
  },
  // ── Precio y cotización ───────────────────────────────────────────────────────────────
  {
    id: "precio-nac",
    etapas: ["primer_contacto", "consulta"],
    situacion: "pide_precio",
    producto: "nac600",
    cliente: "Precio",
    respuesta:
      "• 1 frasco *S/119* • 2 frascos *S/189* • 3 frascos *S/199* ⭐ (sale a S/2,20 al día, 90 días)\nEnvío gratis y en Lima pagas al recibir. ¿Te separo el de 3?",
    origen: "modelo",
  },
  {
    id: "precio-termix",
    etapas: ["primer_contacto", "consulta"],
    situacion: "pide_precio",
    producto: "termix",
    cliente: "Cuánto cuesta?",
    respuesta:
      "• 1 tobillera *S/79* • 2 tobilleras *S/139* ⭐ • 3 tobilleras *S/189*\nEnvío gratis a todo el Perú. ¿Te separo el par para ambos tobillos?",
    origen: "modelo",
  },
  {
    id: "elige-pack-lima",
    etapas: ["cotizado", "datos_lima"],
    situacion: "elige_pack",
    cliente: "Quiero el de 3, soy de Los Olivos",
    respuesta:
      "¡Excelente elección! 3 frascos por *S/199*, envío gratis a Los Olivos y pagas al recibir por Yape, Plin o transferencia. Pásame tu nombre y dirección con una referencia, y dime qué día te acomoda recibirlo.",
    origen: "modelo",
  },
  {
    id: "real-quiere-2",
    etapas: ["consulta", "cotizado"],
    situacion: "elige_pack",
    cliente: "Si deseo 2 por favor, en la página no me deja comprar",
    respuesta:
      "¡Claro! Te lo registro por aquí: 2 frascos por *S/189* con envío gratis. ¿A qué distrito te lo enviamos?",
    origen: "modelo",
  },
  // ── Objeciones ────────────────────────────────────────────────────────────────────────
  {
    id: "caro-nac",
    etapas: ["cotizado", "consulta"],
    situacion: "caro",
    producto: "nac600",
    cliente: "Uy está caro",
    respuesta:
      "Te entiendo. El de 3 sale a S/2,20 al día y te dura 90 días; si prefieres probar primero, el de 1 es *S/119* y pagas al recibir. ¿Con cuál empezamos?",
    origen: "modelo",
  },
  {
    id: "caro-termix",
    etapas: ["cotizado", "consulta"],
    situacion: "caro",
    producto: "termix",
    cliente: "Muy caro",
    respuesta:
      "Te entiendo. Puedes empezar con 1 por *S/79* con envío gratis y pagas al recibir en Lima. ¿Te la separo?",
    origen: "modelo",
  },
  {
    id: "lo-pienso",
    etapas: ["cotizado", "consulta", "datos_lima", "datos_provincia"],
    situacion: "lo_pienso",
    cliente: "Ok, lo voy a pensar",
    respuesta:
      "Claro, sin apuro. ¿Qué te hace dudar: el precio, cómo funciona o el envío? Así te ayudo con eso. Si quieres, te lo dejo separado sin compromiso.",
    origen: "modelo",
  },
  {
    id: "tercero",
    etapas: ["cotizado", "consulta"],
    situacion: "consulta_tercero",
    cliente: "Lo consulto con mi esposo y te aviso",
    respuesta:
      "Perfecto. Te dejo el resumen para que se lo pases: 3 frascos de NAC600 por *S/199*, envío gratis y en Lima pagas al recibir. ¿Te lo separo mientras tanto?",
    origen: "modelo",
  },
  {
    id: "confianza-lima",
    etapas: ["consulta", "cotizado", "datos_lima"],
    situacion: "confianza",
    cliente: "¿Cómo sé que no es estafa?",
    respuesta:
      "Buena pregunta. En Lima no adelantas nada: pagas recién cuando lo tienes en tus manos. Somos Aliv Perú, RUC 20612283134. ¿A qué distrito te lo enviamos?",
    origen: "modelo",
  },
  {
    id: "confianza-provincia",
    etapas: ["datos_provincia", "adelanto"],
    situacion: "confianza",
    cliente: "Y si pago el adelanto y no me llega?",
    respuesta:
      "Te entiendo. Despachamos con guía oficial de Shalom a tu nombre y te paso el número para que lo rastrees en su web. Somos Aliv Perú, RUC 20612283134, y el saldo lo pagas recién cuando llega a tu agencia. ¿Te lo envío a la agencia que te propuse?",
    origen: "modelo",
  },
  {
    id: "funciona",
    etapas: ["consulta", "cotizado"],
    situacion: "funciona",
    producto: "nac600",
    cliente: "De verdad funciona?",
    respuesta:
      "Aporta 600 mg de NAC, que ayuda a tu cuerpo a producir glutatión, y NAD+ para la energía celular. Lo que más ayuda es tomarlo todos los días; por eso el pack de 3 (90 días) es el más elegido. ¿Te lo separo?",
    origen: "modelo",
  },
  {
    id: "entrega-lima",
    etapas: ["consulta", "cotizado"],
    situacion: "entrega",
    cliente: "Cuánto demora a Los Olivos?",
    respuesta:
      "Llega en 2 días hábiles, de lunes a sábado, y pagas al recibir. ¿Te separo los 3 frascos por *S/199* para Los Olivos?",
    origen: "modelo",
  },
  {
    id: "pago-lima",
    etapas: ["consulta", "cotizado"],
    situacion: "pago",
    cliente: "Cómo se paga?",
    respuesta:
      "En Lima pagas al recibir en tu puerta por Yape, Plin o transferencia; no adelantas nada. ¿A qué distrito te lo enviamos?",
    origen: "modelo",
  },
  {
    id: "silencio-ok",
    etapas: ["cotizado"],
    situacion: "silencio_ok",
    cliente: "ok",
    respuesta:
      "Te lo dejo listo: 3 frascos por *S/199*, envío gratis y pagas al recibir. ¿A qué distrito te lo enviamos?",
    origen: "modelo",
  },
  {
    id: "promete-volver",
    etapas: ["cotizado", "datos_lima", "datos_provincia", "adelanto"],
    situacion: "promete_volver",
    cliente: "En unos 20 minutos le paso los datos",
    respuesta: "Perfecto, aquí te espero 🙌 Te dejo tu pedido separado para registrarlo apenas me escribas.",
    origen: "modelo",
  },
  // ── Provincia: agencia → adelanto → DNI (en ese orden) ───────────────────────────────
  {
    id: "provincia-agencia",
    etapas: ["cotizado", "datos_provincia"],
    situacion: "entrega",
    cliente: "Soy de Arequipa, quiero el de 3",
    respuesta:
      "¡Genial! Te lo enviamos gratis por Shalom. La agencia más cercana es *Shalom [Nombre]* ([Dirección]). ¿Te lo mando a esa agencia?",
    origen: "modelo",
  },
  {
    id: "provincia-adelanto",
    etapas: ["datos_provincia", "adelanto"],
    situacion: "pago",
    cliente: "Sí, a esa agencia",
    respuesta:
      "Listo. Para emitir tu guía a tu nombre, separas con un adelanto de S/20 al Yape *951365418* (Gerardo Huaynalaya) y me pasas tu nombre completo y DNI. El saldo lo pagas cuando el paquete llegue a tu agencia. ¿Me envías la captura por aquí?",
    origen: "modelo",
  },
  {
    id: "real-provincia-cierre",
    etapas: ["adelanto"],
    situacion: "pago",
    cliente: "Ok",
    respuesta:
      "Perfecto. Para dejar tu pedido de 3 frascos (*S/199*) listo en la agencia, pásame tu nombre completo y DNI para la guía, junto con la captura del adelanto de S/20 al Yape *951365418* (Gerardo Huaynalaya). Quedo atento por aquí.",
    origen: "real",
  },
  // ── Chats reales que terminaron en pedido (12 al 21/11, auditoría 21/11 V5) ───────────
  {
    id: "real-ancla-3-lima",
    etapas: ["cotizado", "datos_lima"],
    situacion: "elige_pack",
    producto: "nac600",
    cliente: "Quiero 2, soy de Lima",
    respuesta:
      "Perfecto: 2 frascos de *NAC600 + NAD+* por *S/189*. Un dato: por solo 10 soles más te llevas 3 frascos y tienes 90 días de uso diario. Pagas al recibir por transferencia, Yape o Plin. ¿Qué día y en qué horario te encuentras?",
    origen: "real",
  },
  {
    id: "real-ancla-2-provincia",
    etapas: ["cotizado", "datos_provincia"],
    situacion: "elige_pack",
    producto: "nac600",
    cliente: "1 frasco",
    respuesta:
      "Perfecto, 1 frasco de *NAC600 + NAD+* por *S/119*. Un dato: por 70 soles más te llevas 2 y tienes 60 días de uso diario. Para enviártelo a tu agencia Shalom, confírmame tu nombre completo y tu DNI.",
    origen: "real",
  },
  {
    id: "real-cierre-alternativa",
    etapas: ["cotizado", "datos_lima"],
    situacion: "silencio_ok",
    cliente: "Ok, por ahora solo el del hígado",
    respuesta:
      "Entendido. Nos quedamos con los 3 frascos de *NAC600 + NAD+* por *S/199* con envío gratis. ¿Te lo programamos para este martes en la mañana o prefieres otro día?",
    origen: "real",
  },
  {
    id: "real-web-no-deja",
    etapas: ["consulta", "cotizado"],
    situacion: "elige_pack",
    cliente: "Sí deseo 2, en la página no me deja comprar",
    respuesta:
      "No te preocupes, te ayudo a registrarlo directamente por aquí para que no tengas problema. ¿Son 2 frascos de *NAC600 + NAD+* (*S/189*) o 2 *Termix Tobilleras* (*S/139* el par)?",
    origen: "real",
  },
  {
    id: "real-agencia-opciones",
    etapas: ["datos_provincia", "adelanto"],
    situacion: "entrega",
    cliente: "¿A qué agencia de Sullana me lo pueden enviar?",
    respuesta:
      "¿A qué agencia Shalom prefieres el envío: Zona Industrial, Bellavista, Ignacio Escudero o Santa Rosa? Con eso y tu DNI dejo lista tu guía.",
    origen: "real",
  },
  // ── «No tengo dinero» (sin presión: una opción más chica y la puerta abierta) ──────────
  {
    id: "sin-dinero-nac",
    etapas: ["consulta", "cotizado", "datos_lima", "datos_provincia"],
    situacion: "sin_dinero",
    producto: "nac600",
    cliente: "Ahorita no tengo dinero",
    respuesta:
      "Te entiendo, no te preocupes. Si te sirve, puedes empezar con 1 frasco a *S/119* y en Lima pagas recién al recibir. Y si prefieres esperar, aquí estaré cuando lo necesites 🌿",
    origen: "modelo",
  },
  {
    id: "sin-dinero-termix",
    etapas: ["consulta", "cotizado", "datos_lima", "datos_provincia"],
    situacion: "sin_dinero",
    producto: "termix",
    cliente: "No me alcanza ahora",
    respuesta:
      "Te entiendo. Si te sirve, puedes empezar con 1 tobillera a *S/79* con envío gratis y en Lima pagas al recibir. Y si prefieres esperar, aquí estaré cuando lo necesites 🙂",
    origen: "modelo",
  },
  // ── Datos de envío (Lima) ─────────────────────────────────────────────────────────────
  {
    id: "lima-falta-direccion",
    etapas: ["datos_lima"],
    cliente: "Ya, a nombre de Carmen Ruiz",
    respuesta: "Gracias, Carmen. ¿Me pasas tu dirección con número y una referencia en San Juan de Lurigancho?",
    origen: "modelo",
  },
];
