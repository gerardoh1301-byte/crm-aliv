# Configuración y pasos pendientes

## Datos del sistema

| Qué | Valor |
|---|---|
| Hoja | [Sistema integrado Aliv Perú](https://docs.google.com/spreadsheets/d/1N8XO47szW0mtOKA5fOHUKzaKsJz1wMXwrX-GpysVbkE/edit), dueña: gerardoh1301@gmail.com |
| CRM | https://crm-aliv.onrender.com · repo `gerardoh1301-byte/crm-aliv` · rama `sistema-integrado` |
| Métricas del CRM | `GET /api/metricas` con `Authorization: Bearer <METRICAS_TOKEN>` |
| Meta Ads | cuenta `1453744092152467` · píxel `3426791420822995` |
| Shopify | alivstore.shop |
| WhatsApp Business | +51 944 392 731 |

## Checklist (tú)

- [ ] **1. Dar a Claude permiso de edición en la hoja.** El conector de Google Sheets de Claude no está vinculado a gerardoh1301@gmail.com: puede leer la hoja (el enlace es público) pero no escribirla, y no ve tus hojas privadas. Opciones:
  - en claude.ai → *Configuración → Conectores → Google Sheets*, desconéctalo y vuelve a conectarlo **con gerardoh1301@gmail.com**; o
  - comparte la hoja como **Editor** con la cuenta que aparece en ese conector.

  Luego pídele a Claude "deja lista la hoja del panel": corre `scripts/hoja_inicial.py` y la arma.
- [ ] **2. Fusionar el CRM** siguiendo `crm/CAMBIOS-CRM.md` → "Al fusionar". Incluye crear `METRICAS_TOKEN` en Render.
- [ ] **3. Cambiar las claves** (Zernio, Gemini, secreto del webhook, PIN) y sacarlas de la documentación de Antigravity (`SKILLS ANTIGRAVITY/CRM Mensajes Alivperu/references/arquitectura-crm.md` y `SKILL.md`). El token de GitHub también está escrito en la URL del repo local (`git remote -v`): cámbialo por uno nuevo o usa el administrador de credenciales.
- [ ] **4. Botón de confirmación** en la página de gracias: `crm/boton-confirmar-easysell.md`.
- [ ] **5. Tareas en la nube:** `tareas-nube.md` (entorno con network secret + 3 tareas).
- [ ] **6. Decidir la política de provincia** (adelanto de S/20 o agencia con DNI) en `reglas-comerciales.md`.
- [ ] **7. Decidir Gemini gratis o con facturación** (privacidad de los chats): `decisiones-pago.md`.

Los pasos 1, 2 y 5 son los que encienden el panel automático. Hasta entonces, las skills funcionan a mano en tu PC (Meta y Shopify ya responden).
