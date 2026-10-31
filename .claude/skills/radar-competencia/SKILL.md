---
name: radar-competencia
description: Radar semanal de la competencia de Aliv Perú en la Biblioteca de anuncios de Meta (Perú) — busca anuncios de productos parecidos, prioriza los que llevan más días activos (señal de que les rinden), registra gancho, oferta, formato y CTA en la pestaña Competencia de la hoja y resume los ángulos que se repiten y los huecos. Úsala cuando el usuario pida espiar o investigar a la competencia, ver qué anuncios ganadores hay en el mercado, ideas de ángulos o ganchos, o cuando la ejecute la tarea programada de los lunes. Para un análisis puntual dentro de una campaña, `aliv-peru-ecommerce/references/meta-ads.md` tiene el mismo método.
---

# Radar de competencia

> **Documentos del sistema** (`reglas-comerciales.md`, `decisiones-pago.md`, `tareas-nube.md`, `configuracion.md`): en la nube, carpeta `sistema-integrado/` en la raíz del repo `crm-aliv`; en la PC, `C:/Users/USER/Desktop/ECOOMERCE/SKILLS CLAUDE/sistema integrado/`.

Es el "escanea cientos de anuncios de la competencia y se queda con los que llevan semanas corriendo" del video, hecho semana a semana para ver qué **sigue** vivo.

## Flujo

**1. Buscar** con `ads_library_search`, país `PE`, anuncios activos. Términos por producto:
- NAC600: "NAC", "N-acetilcisteína", "glutatión", "antioxidante", "hígado".
- Termix: "tobillera térmica", "masajeador tobillo", "hombrera térmica", "grafeno".
- Agrega los de productos nuevos que esté evaluando `buscador-productos-peru`.

**2. Priorizar** por días activo (fecha de inicio antigua y todavía activo). Quédate con unos 15–25 relevantes.

**3. Comparar con la semana anterior.** Lee `Competencia!A:L`. Un anuncio que ya estaba y sigue activo es la mejor señal: súbele los días. No dupliques filas: si `id_biblioteca` (C) ya existe, actualiza `dias_activo` (D) y la fecha (A) de esa fila en lugar de agregar otra.

**4. Registrar** los nuevos con `append_values` en `Competencia!A:L`: `[fecha, pagina, 'id_biblioteca, dias_activo, formato, gancho de los primeros 3 s, oferta y precio, cta, destino (web/WhatsApp), angulo, link, nota]`. El `id_biblioteca` va con apóstrofo delante para que Sheets no lo redondee.

**5. Resumir** en Registro (`[fecha_hora, "radar", "ok", resumen]`, máximo ~500 caracteres): 3–5 ángulos que se repiten, huecos que nadie cubre y ofertas que compiten con S/119 / S/189 / S/199. El director lo menciona en la lectura del lunes.

## Reglas

- **Inspírate, no copies.** Nada de textos, videos ni marcas de otros.
- Lo que haga la competencia **no excusa la política de salud** de `reglas-comerciales.md`: si ellos dicen "desintoxica tu hígado", Aliv no.
- Las ideas pasan a la skill de videos o creativos como brief, con el ángulo y el gancho, nunca como copia.
