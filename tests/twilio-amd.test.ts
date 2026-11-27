import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { esContestadora, firmaTwilio, firmaTwilioValida } from "@/lib/voice/twilio-amd";

describe("esContestadora", () => {
  it("cuelga con buzón o fax", () => {
    for (const v of ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"]) {
      expect(esContestadora(v)).toBe(true);
    }
  });
  it("sigue con persona o resultado dudoso", () => {
    expect(esContestadora("human")).toBe(false);
    expect(esContestadora("unknown")).toBe(false);
    expect(esContestadora(undefined)).toBe(false);
  });
});

describe("firma de Twilio", () => {
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  // URL + parámetros ordenados alfabéticamente (clave+valor), HMAC-SHA1 en base64.
  const esperada = createHmac("sha1", "12345")
    .update(url + "CallSidCA1234567890ABCDECaller+12349013030Digits1234From+12349013030To+18005551212")
    .digest("base64");
  it("sigue el algoritmo de Twilio", () => {
    expect(firmaTwilio(url, params, "12345")).toBe(esperada);
  });
  it("rechaza firmas ajenas o vacías", () => {
    expect(firmaTwilioValida(url, params, esperada, "12345")).toBe(true);
    expect(firmaTwilioValida(url, params, "otra", "12345")).toBe(false);
    expect(firmaTwilioValida(url, params, null, "12345")).toBe(false);
  });
});
