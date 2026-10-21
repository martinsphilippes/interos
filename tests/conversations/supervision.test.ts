/**
 * Regras puras da supervisão (fase 2): estado do operador, alertas do gerente e chave do motivo de pausa.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MANAGER_ALERTS, evaluateAlerts, minutesInState, operatorState, pauseKeyOf, type AlertSnapshot } from "@/domain/central-ops";

const NOW = Date.UTC(2026, 9, 21, 15, 0, 0);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("estado do operador", () => {
  it("disponível, ocupado (no limite ou marcou), pausa, ausente e offline", () => {
    expect(operatorState({ presence: "online", presenceUpdatedAt: ago(5) }, 1, 4, NOW)).toBe("disponivel");
    expect(operatorState({ presence: "online", presenceUpdatedAt: ago(5) }, 4, 4, NOW)).toBe("ocupado");
    expect(operatorState({ presence: "ocupado", presenceUpdatedAt: ago(5) }, 0, 4, NOW)).toBe("ocupado");
    expect(operatorState({ presence: "online", presenceUpdatedAt: ago(5), central: { attends: false } }, 0, 4, NOW)).toBe("ocupado");
    expect(operatorState({ presence: "pausa", presenceUpdatedAt: ago(800) }, 0, 4, NOW)).toBe("pausa");
    expect(operatorState({ presence: "ausente", presenceUpdatedAt: ago(5) }, 0, 4, NOW)).toBe("ausente");
    expect(operatorState({ presence: "online", presenceUpdatedAt: ago(13 * 60) }, 0, 4, NOW)).toBe("offline");
    expect(operatorState({}, 0, 4, NOW)).toBe("offline");
    expect(minutesInState(ago(42), NOW)).toBe(42);
  });

  it("chave do motivo de pausa", () => {
    expect(pauseKeyOf("Problema técnico")).toBe("problema_tecnico");
    expect(pauseKeyOf("  Café!! ")).toBe("cafe");
  });
});

describe("alertas do gerente", () => {
  const snapshot: AlertSnapshot = {
    queues: [
      { id: "q1", name: "Suporte N1", waiting: 7, oldestWaitingSince: ago(12), managerIds: ["g1"] },
      { id: "q2", name: "Comercial", waiting: 2, managerIds: ["g2"] },
    ],
    conversations: [
      { id: "c1", number: "AT-1", assigneeId: "op1", awaitingReply: true, waitingSince: ago(15), slaState: "em_risco", managerIds: ["g1"] },
      { id: "c2", number: "AT-2", assigneeId: "op2", awaitingReply: true, waitingSince: ago(3), managerIds: ["g1"] },
    ],
    operators: [
      { id: "op1", name: "Ana", presence: "pausa", presenceUpdatedAt: ago(75), pauseReasonKey: "almoco", managerIds: ["g1"] },
      { id: "op2", name: "Bia", presence: "pausa", presenceUpdatedAt: ago(10), pauseReasonKey: "cafe", managerIds: ["g1"] },
    ],
    pauseReasons: [
      { key: "almoco", label: "Almoço", maxMinutes: 60, active: true },
      { key: "cafe", label: "Café", maxMinutes: 15, active: true },
    ],
  };

  it("tudo desligado (padrão): nenhum alerta", () => {
    expect(evaluateAlerts(snapshot, DEFAULT_MANAGER_ALERTS, NOW)).toEqual([]);
  });

  it("ligados: fila cheia, SLA em risco, cliente sem resposta e pausa longa, cada um para quem deve", () => {
    const alerts = evaluateAlerts(snapshot, { queue: { active: true, maxWaiting: 5 }, sla: { active: true }, idle: { active: true, minutes: 10 }, pause: { active: true }, repeatMinutes: 30 }, NOW);
    const byKey = Object.fromEntries(alerts.map((a) => [a.key.split(":").slice(0, 2).join(":"), a]));
    expect(Object.keys(byKey).sort()).toEqual(["fila:q1", "parado:c1", "pausa:op1", "sla:c1"]);
    expect(byKey["fila:q1"].userIds).toEqual(["g1"]);
    expect(byKey["fila:q1"].body).toContain("12 min");
    expect(byKey["sla:c1"].userIds.sort()).toEqual(["g1", "op1"]);
    expect(byKey["pausa:op1"].title).toContain("Almoço");
  });
});
