# Regla Crítica de Seguridad: Prohibición de Entrega de Claves de Retiro por la IA

## Antecedente
En un chat con envío por Shalom (+51 992 618 110 - Yess), el cliente preguntó por el saldo y número de Yape, y el bot alucinó/expuso la clave de recojo `(0011)` afirmando erróneamente que ya se había transferido el saldo. Con dicha clave de retiro, el cliente habría podido retirar su paquete en la agencia sin haber completado el pago del saldo restante.

## Regla de Oro Absoluta
1. **BAJO NINGUNA CIRCUNSTANCIA LA IA/BOT PUEDE ENVIAR, COMPARTIR, CONFIRMAR O INVENTAR CÓDIGOS O CLAVES DE RETIRO/RECOJO.**
2. **ENTREGA 100% EXCLUSIVA POR ASESORES HUMANOS:**
   - La clave secreta de recojo en ventanilla de Shalom se entrega ÚNICAMENTE por un asesor humano después de que el equipo de administración haya verificado el abono bancario/Yape en cuenta.
3. **Respuesta obligatoria del bot ante solicitud de clave o constancia de saldo:**
   - *"Muchas gracias por tu constancia. Nuestro equipo de administración verificará tu abono en cuenta y un asesor humano te enviará de inmediato tu clave de retiro para que puedas recoger tu paquete en la agencia."*
   - Ejecutar inmediatamente la herramienta `avisar_asesor` con motivo `abono_saldo_verificar_clave`.
4. **Filtros de Sistema Activos:**
   - `renderContexto`: Purga `clave_recojo` de `customFields` para que la IA nunca la reciba en su prompt.
   - `deliverMessage`: Guardrail de salida que detecta e intercepta cualquier número o patrón de clave si proviene del agente (`origin === "agent"`).
