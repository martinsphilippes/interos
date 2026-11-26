/** Remuneração variável (src/domain/variable-pay.ts): soma por colaborador, pendentes, bônus, prêmios, fechamento e alertas. */
import { describe, expect, it } from "vitest";
import { buildVariablePayLines, campaignPrizeWinners } from "@/domain/variable-pay";

const people = [
  { id: "ana", name: "Ana", department: "Vendas" },
  { id: "bruno", name: "Bruno", department: "Vendas" },
  { id: "carla", name: "Carla", department: "CS" },
];

describe("buildVariablePayLines", () => {
  it("soma comissões adquiridas + bônus + prêmios; pendentes ficam à parte; canceladas/estornadas não contam", () => {
    const { lines, totals } = buildVariablePayLines({
      people,
      commissions: [
        { userId: "ana", amount: 100, status: "liberada" },
        { userId: "ana", amount: 50, status: "paga" },
        { userId: "ana", amount: 30, status: "titulo_gerado" },
        { userId: "ana", amount: 70, status: "prevista" },
        { userId: "ana", amount: 999, status: "cancelada" },
        { userId: "ana", amount: 888, status: "estornada" },
      ],
      bonuses: [{ userId: "ana", amount: 200, source: "fechado", blocked: false, tier: "Meta" }],
      prizes: [{ userId: "ana", amount: 1518, items: ["Meta de adesão batida"] }],
    });
    const ana = lines.find((l) => l.userId === "ana")!;
    expect(ana.commissions.earned).toBe(180);
    expect(ana.commissions.paid).toBe(50);
    expect(ana.potential).toBe(70);
    expect(ana.total).toBe(180 + 200 + 1518);
    expect(totals.total).toBe(ana.total);
    expect(ana.alerts).toHaveLength(0);
  });
  it("bônus bloqueado vale zero e gera alerta; projeção também avisa", () => {
    const { lines } = buildVariablePayLines({
      people,
      commissions: [],
      bonuses: [
        { userId: "ana", amount: 300, source: "fechado", blocked: true },
        { userId: "bruno", amount: 120, source: "projetado", blocked: false },
      ],
      prizes: [],
    });
    expect(lines.find((l) => l.userId === "ana")).toBeUndefined();
    const bruno = lines.find((l) => l.userId === "bruno")!;
    expect(bruno.total).toBe(120);
    expect(bruno.alerts.join(" ")).toContain("projetado");
  });
  it("comissão bloqueada aparece como alerta e não entra no total", () => {
    const { lines } = buildVariablePayLines({ people, commissions: [{ userId: "carla", amount: 40, status: "bloqueada" }], bonuses: [], prizes: [] });
    expect(lines[0].total).toBe(0);
    expect(lines[0].alerts.join(" ")).toContain("bloqueadas");
  });
  it("compara com o fechamento e aponta o que mudou depois", () => {
    const { lines } = buildVariablePayLines({
      people,
      commissions: [{ userId: "ana", amount: 150, status: "liberada" }],
      bonuses: [],
      prizes: [],
      closed: [
        { userId: "ana", commissions: 100, bonus: 0, prizes: 0, total: 100 },
        { userId: "bruno", commissions: 10, bonus: 0, prizes: 0, total: 10 },
      ],
    });
    const ana = lines.find((l) => l.userId === "ana")!;
    expect(ana.diffSinceClose).toBe(50);
    expect(ana.alerts.join(" ")).toContain("mudou depois do fechamento");
    const bruno = lines.find((l) => l.userId === "bruno")!;
    expect(bruno.diffSinceClose).toBe(-10);
  });
  it("ordena pelo total e conta as pessoas", () => {
    const { lines, totals } = buildVariablePayLines({
      people,
      commissions: [
        { userId: "ana", amount: 10, status: "liberada" },
        { userId: "bruno", amount: 90, status: "liberada" },
      ],
      bonuses: [],
      prizes: [],
    });
    expect(lines.map((l) => l.userId)).toEqual(["bruno", "ana"]);
    expect(totals.people).toBe(2);
    expect(totals.commissions).toBe(100);
  });

  it("prêmio de campanha em apuração soma e avisa", () => {
    const { lines } = buildVariablePayLines({ people, commissions: [], bonuses: [], prizes: [{ userId: "ana", amount: 300, items: ['Campanha "SLA"'], provisional: true }] });
    expect(lines[0].prizes.amount).toBe(300);
    expect(lines[0].alerts.join(" ")).toContain("em apuração");
  });
});

describe("campaignPrizeWinners", () => {
  const rows = [
    { userId: "a", attainment: 1.2, reached: true },
    { userId: "b", attainment: 0.8, reached: false },
    { userId: "c", attainment: 1.5, reached: true },
    { userId: "d", attainment: 1.0, reached: true },
    { userId: "e", attainment: null, reached: false },
  ];
  it("sem limite: todos que bateram a meta, na ordem do ranking", () => {
    expect(campaignPrizeWinners(rows)).toEqual(["c", "a", "d"]);
  });
  it("com limite: só os N primeiros", () => {
    expect(campaignPrizeWinners(rows, 2)).toEqual(["c", "a"]);
    expect(campaignPrizeWinners(rows, 10)).toEqual(["c", "a", "d"]);
  });
  it("ninguém bateu: ninguém ganha", () => {
    expect(campaignPrizeWinners(rows.map((r) => ({ ...r, reached: false })), 3)).toEqual([]);
  });
});
