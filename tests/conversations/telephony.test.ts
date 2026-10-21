/**
 * Telefonia (fases 3 e 4): número E.164, resultado da ligação, TwiML, token do softphone, assinatura da Twilio, custo
 * estimado e conferência da supervisão.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callCost, callStatusFromProvider, callStatusOf, conferenceName, conferenceTwiml, incomingTwiml, isBrMobile, isExtension, monitorParticipantState, monitoredDuration, needsCallback, outgoingTwiml, toE164, transferTwiml, voicemailTwiml, xmlEscape } from "@/domain/telephony";
import { twilioSignatureValid, voiceAccessToken } from "@/server/integrations/twilio";

describe("números", () => {
  it("formato internacional com o 9 do celular", () => {
    expect(toE164("(88) 9981-1204")).toBe("+5588999811204"); // celular sem o 9: ganha o 9
    expect(toE164("88 99811-2040")).toBe("+5588998112040");
    expect(toE164("+55 88 3570-0001")).toBe("+558835700001");
    expect(toE164("088 99811-2040")).toBe("+5588998112040");
    expect(toE164("+1 415 555 0100")).toBe("+14155550100");
    expect(toE164("123")).toBeNull();
    expect(isExtension("103")).toBe(true);
    expect(isExtension("1a")).toBe(false);
  });
});

describe("resultado da ligação", () => {
  it("do provedor para o INTEROS", () => {
    expect(callStatusFromProvider("completed", "entrada", 42)).toBe("atendida");
    expect(callStatusFromProvider("no-answer", "entrada")).toBe("perdida");
    expect(callStatusFromProvider("busy", "saida")).toBe("ocupado");
    expect(callStatusFromProvider("no-answer", "saida")).toBe("sem_resposta");
    expect(callStatusFromProvider("failed", "saida")).toBe("falha");
  });

  it("registro antigo sem o campo e perdida sem retorno", () => {
    expect(callStatusOf({ direction: "saida", durationSeconds: 30 })).toBe("atendida");
    expect(callStatusOf({ direction: "entrada", durationSeconds: 0 })).toBe("perdida");
    expect(needsCallback({ direction: "entrada", callStatus: "perdida" })).toBe(true);
    expect(needsCallback({ direction: "entrada", callStatus: "perdida", returnedAt: "2026-10-21T10:00:00Z" })).toBe(false);
    expect(needsCallback({ direction: "saida", callStatus: "sem_resposta" })).toBe(false);
  });
});

describe("TwiML", () => {
  it("escapa texto e toca em todos os ramais com a ligação principal", () => {
    const xml = incomingTwiml({ welcome: "Olá & bem-vindo", recordingNotice: "Gravamos", record: true, clients: ["u1", "u2"], ringSeconds: 25, parentCallSid: "CA123", from: "+5588998112040", dialAction: "https://x/api/voice/dial-result", recordingCallback: "https://x/api/voice/recording" });
    expect(xml).toContain("Olá &amp; bem-vindo");
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml.match(/<Client>/g)).toHaveLength(2);
    expect(xml).toContain('<Parameter name="parentCallSid" value="CA123"/>');
    expect(xml).toContain('timeout="25"');
  });

  it("sem gravação não avisa; correio de voz, saída e transferência", () => {
    expect(incomingTwiml({ welcome: "", recordingNotice: "Gravamos", record: false, clients: ["u1"], ringSeconds: 99, parentCallSid: "CA1", from: "", dialAction: "a", recordingCallback: "b" })).not.toContain("Gravamos");
    expect(voicemailTwiml("Deixe recado", true, "act", "cb")).toContain('<Record maxLength="120"');
    expect(voicemailTwiml("Fechado", false, "act", "cb")).toContain("<Hangup/>");
    expect(outgoingTwiml({ to: "+5588998112040", callerId: "+558835700001", record: false, dialAction: "a", recordingCallback: "b" })).toContain('<Number>+5588998112040</Number>');
    expect(transferTwiml({ client: "u9" })).toContain("<Client>u9</Client>");
    expect(xmlEscape(`"<'>`)).toBe("&quot;&lt;&apos;&gt;");
  });
});

describe("Twilio", () => {
  it("assinatura dos avisos: URL + parâmetros em ordem, HMAC-SHA1 base64", () => {
    const url = "https://interos.app/api/voice/incoming";
    const params = { CallSid: "CA1", From: "+5588998112040", To: "+558835700001" };
    const sig = createHmac("sha1", "tok").update(url + "CallSidCA1From+5588998112040To+558835700001").digest("base64");
    expect(twilioSignatureValid(url, params, sig, "tok")).toBe(true);
    expect(twilioSignatureValid(url, { ...params, To: "+558800000000" }, sig, "tok")).toBe(false);
    expect(twilioSignatureValid(url, params, sig, "outro")).toBe(false);
    expect(twilioSignatureValid(url, params, null, "tok")).toBe(false);
  });

  it("token do softphone: JWT com a identidade e as permissões de voz", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_API_KEY_SID = "SKtest";
    process.env.TWILIO_API_KEY_SECRET = "segredo";
    process.env.TWILIO_TWIML_APP_SID = "APtest";
    const t = voiceAccessToken("user_rafael", Date.UTC(2026, 9, 21))!;
    const [h, p, s] = t.token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "HS256", cty: "twilio-fpa;v=1" });
    expect(payload).toMatchObject({ iss: "SKtest", sub: "ACtest", grants: { identity: "user_rafael", voice: { incoming: { allow: true }, outgoing: { application_sid: "APtest" } } } });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(s).toBe(createHmac("sha256", "segredo").update(`${h}.${p}`).digest("base64url"));
    for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_TWIML_APP_SID"]) delete process.env[k];
    expect(voiceAccessToken("x")).toBeNull();
  });
});

describe("custo estimado (fase 4)", () => {
  const rates = { fixo: 0.1, movel: 0.4, entrada: 0.05 };
  it("minutos iniciados × tarifa (celular, fixo ou recebida)", () => {
    expect(isBrMobile("+5588998112040")).toBe(true);
    expect(isBrMobile("+558835700001")).toBe(false);
    expect(callCost({ provider: "twilio", direction: "saida", durationSeconds: 61, toNumber: "+5588998112040" }, rates)).toBe(0.8);
    expect(callCost({ provider: "twilio", direction: "saida", durationSeconds: 60, toNumber: "+558835700001" }, rates)).toBe(0.1);
    expect(callCost({ provider: "twilio", direction: "entrada", durationSeconds: 125 }, rates)).toBe(0.15);
    expect(callCost({ provider: "twilio", direction: "saida", durationSeconds: 0, toNumber: "+558835700001" }, rates)).toBe(0);
  });
  it("sem custo conhecido: registro manual ou tarifas não configuradas", () => {
    expect(callCost({ provider: "manual", direction: "saida", durationSeconds: 300 }, rates)).toBeNull();
    expect(callCost({ provider: "twilio", direction: "saida", durationSeconds: 300 }, { fixo: 0, movel: 0, entrada: 0 })).toBeNull();
  });
});

describe("supervisão de ligações (fase 4)", () => {
  it("conferência sem bipe nem música; o gerente entra mudo e não derruba a ligação ao sair", () => {
    const name = conferenceName("call_abc");
    expect(name).toBe("sup_call_abc");
    const agent = conferenceTwiml({ name, endOnExit: true, recordingCallback: "https://x/api/voice/recording?call=CA1&parte=1" });
    expect(agent).toContain('beep="false"');
    expect(agent).toContain('waitUrl=""');
    expect(agent).toContain('endConferenceOnExit="true"');
    expect(agent).toContain('record="record-from-start"');
    expect(agent).toContain("call=CA1&amp;parte=1");
    const sup = conferenceTwiml({ name, endOnExit: false, muted: true, action: "https://x/api/voice/monitor-end?call=call_abc" });
    expect(sup).toContain('endConferenceOnExit="false"');
    expect(sup).toContain('muted="true"');
    expect(sup).not.toContain("record=");
    expect(sup).toContain('<Dial action="https://x/api/voice/monitor-end?call=call_abc">');
  });
  it("modos: ouvir (mudo), sussurrar (só o atendente ouve), entrar (todos ouvem)", () => {
    expect(monitorParticipantState("ouvir", "CAag")).toEqual({ muted: true, coaching: false });
    expect(monitorParticipantState("sussurrar", "CAag")).toEqual({ muted: false, coaching: true, callSidToCoach: "CAag" });
    expect(monitorParticipantState("intervir", "CAag")).toEqual({ muted: false, coaching: false });
  });
  it("duração total = antes de mover + tempo na conferência", () => {
    const movedAt = new Date(Date.UTC(2026, 9, 21, 12, 0, 0)).toISOString();
    expect(monitoredDuration({ movedAt, partialSeconds: 90 }, Date.UTC(2026, 9, 21, 12, 2, 0))).toBe(210);
    expect(monitoredDuration({ partialSeconds: 30 })).toBe(30);
  });
});
