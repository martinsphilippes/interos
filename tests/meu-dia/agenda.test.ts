/**
 * Agenda do Meu Dia (buildAgendaDays): hoje e os 6 dias seguintes em America/Sao_Paulo, rótulos dos dias, o que entra
 * (tarefas pelo prazo, visitas, treinamentos, checkpoints da carteira e follow-ups sem repetir a tarefa do mesmo dia),
 * ordem por horário, feitos e atrasados, dono na visão da equipe, itens de telas que o usuário não abre fora da agenda
 * e o limite por dia.
 */
import { describe, expect, it } from "vitest";
import { AGENDA_DAYS, AGENDA_DAY_MAX_ITEMS, buildAgendaDays, type AgendaSources } from "@/server/meu-dia/queries";

// 10/11/2026 (terça) — 12:00 em São Paulo.
const TODAY = "2026-11-10";
const NOW = "2026-11-10T15:00:00.000Z";

function sources(patch: Partial<AgendaSources> = {}): AgendaSources {
  return {
    today: TODAY,
    nowIso: NOW,
    isTeam: false,
    nameOf: (id) => (id ? `Pessoa ${id}` : undefined),
    clientName: (id) => (id ? `Cliente ${id}` : undefined),
    linkable: (href) => href,
    tasks: [],
    visits: [],
    trainings: [],
    csClients: [],
    successPlans: [],
    openLeads: [],
    openOpps: [],
    ...patch,
  };
}

const task = (id: string, extra: Record<string, unknown>) => ({ id, title: `Tarefa ${id}`, status: "aberta", assigneeId: "u1", ...extra }) as never;

describe("agenda do Meu Dia", () => {
  it("hoje e os 6 dias seguintes, com rótulos", () => {
    const days = buildAgendaDays(sources());
    expect(days).toHaveLength(AGENDA_DAYS);
    expect(days.map((d) => d.key)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(days.map((d) => d.label)).toEqual(["Hoje", "Amanhã", "Qui 12", "Sex 13", "Sáb 14", "Dom 15", "Seg 16"]);
    expect(days.map((d) => `${d.tabLabel} ${d.dayNumber}`)).toEqual(["Hoje 10", "Qua 11", "Qui 12", "Sex 13", "Sáb 14", "Dom 15", "Seg 16"]);
    expect(days[2].longLabel).toBe("quinta-feira, 12 de novembro");
    expect(days.every((d) => d.total === 0 && d.items.length === 0)).toBe(true);
  });

  it("entra o que acontece na janela, pelo dia de São Paulo; fora da janela e cancelados ficam de fora", () => {
    const days = buildAgendaDays(
      sources({
        tasks: [
          task("passada", { dueAt: "2026-11-10T13:00:00.000Z" }), // 10:00 de hoje (já passou)
          task("tarde", { dueAt: "2026-11-10T18:00:00.000Z" }), // 15:00 de hoje
          task("feita", { dueAt: "2026-11-10T12:00:00.000Z", status: "concluida" }),
          task("cancelada", { dueAt: "2026-11-10T19:00:00.000Z", status: "cancelada" }),
          task("ontem-sp", { dueAt: "2026-11-10T02:00:00.000Z" }), // 23:00 de 09/11 em SP
          // "Início" é quando alguém começou a tarefa (não um horário planejado): vale o prazo, sem marcar atraso hoje.
          task("inicio", { status: "em_andamento", startAt: "2026-11-10T12:30:00.000Z", dueAt: "2026-11-11T12:00:00.000Z" }),
          task("sem-prazo", { status: "em_andamento", startAt: "2026-11-10T12:30:00.000Z" }),
          task("ultimo-dia", { dueAt: "2026-11-16T23:30:00.000Z" }), // 20:30 de 16/11
          task("fora", { dueAt: "2026-11-17T12:00:00.000Z" }),
        ],
        visits: [
          { id: "v1", status: "agendada", scheduledAt: "2026-11-10T17:00:00.000Z", kind: "comercial", objective: "Apresentação", clientId: "c1", sellerId: "u1" } as never,
          { id: "v2", status: "cancelada", scheduledAt: "2026-11-10T17:30:00.000Z", kind: "comercial", objective: "X", sellerId: "u1" } as never,
          { id: "v3", status: "remarcada", scheduledAt: "2026-11-10T17:45:00.000Z", kind: "tecnica", objective: "Y", sellerId: "u1" } as never,
        ],
        openOpps: [{ id: "o1", title: "Nova venda", nextAction: "Ligar para fechar", nextActionAt: "2026-11-12T13:00:00.000Z", clientId: "c2", ownerId: "u1" } as never],
        openLeads: [{ id: "l1", name: "Maria", company: "Padaria", nextActionAt: "2026-11-10T19:00:00.000Z", ownerId: "u1" } as never],
        trainings: [{ id: "tr1", status: "agendado", subject: "PDV", scheduledAt: "2026-11-13T12:00:00.000Z", clientId: "c3", instructorId: "u1" } as never],
        successPlans: [
          { id: "sp1", status: "ativo", objective: "Adoção", checkpointAt: "2026-11-14T12:00:00.000Z", clientId: "c4", ownerId: "u1" } as never,
          { id: "sp2", status: "concluido", objective: "Antigo", checkpointAt: "2026-11-14T13:00:00.000Z", clientId: "c4", ownerId: "u1" } as never,
        ],
        csClients: [
          { id: "c5", tradeName: "Mercado", status: "ativo", nextInteractionAt: "2026-11-15T12:00:00.000Z", ownerCsId: "u1" } as never,
          // Cancelado: mantém a data antiga, mas saiu da carteira.
          { id: "c6", tradeName: "Antigo", status: "cancelado", nextInteractionAt: "2026-11-15T13:00:00.000Z", ownerCsId: "u1" } as never,
        ],
      }),
    );
    const today = days[0].items;
    expect(today.map((i) => i.id)).toEqual(["tarefa:feita", "tarefa:passada", "visita:v1", "tarefa:tarde", "lead:l1"]);
    expect(today.map((i) => i.timeLabel)).toEqual(["09:00", "10:00", "14:00", "15:00", "16:00"]);
    expect(today.find((i) => i.id === "tarefa:passada")).toMatchObject({ overdue: true, done: false });
    expect(today.find((i) => i.id === "tarefa:feita")).toMatchObject({ overdue: false, done: true });
    expect(today.find((i) => i.id === "tarefa:tarde")?.overdue).toBe(false);
    expect(today.find((i) => i.id === "visita:v1")).toMatchObject({ kind: "visita", title: "Visita · Apresentação", clientName: "Cliente c1", href: "/vendas/visitas?visita=v1" });
    expect(today.find((i) => i.id === "lead:l1")).toMatchObject({ kind: "followup", title: "Follow-up · Maria", clientName: "Padaria", href: "/marketing/leads?lead=l1" });
    expect(days[1].items.map((i) => i.id)).toEqual(["tarefa:inicio"]);
    expect(days[2].items[0]).toMatchObject({ id: "oportunidade:o1", kind: "followup", title: "Follow-up · Ligar para fechar", clientName: "Cliente c2", href: "/vendas?oportunidade=o1", overdue: false });
    expect(days[3].items.map((i) => i.id)).toEqual(["treinamento:tr1"]);
    expect(days[4].items.map((i) => i.id)).toEqual(["plano:sp1"]);
    expect(days[5].items.map((i) => i.id)).toEqual(["checkpoint:c5"]);
    expect(days[6].items.map((i) => i.id)).toEqual(["tarefa:ultimo-dia"]);
    const all = days.flatMap((d) => d.items.map((i) => i.id));
    for (const gone of ["tarefa:cancelada", "tarefa:ontem-sp", "tarefa:fora", "tarefa:sem-prazo", "visita:v2", "visita:v3", "plano:sp2", "checkpoint:c6"]) expect(all).not.toContain(gone);
    expect(days[1].items[0]).toMatchObject({ overdue: false, timeLabel: "09:00" });
    expect(days.map((d) => d.total)).toEqual(days.map((d) => d.items.length));
  });

  it("follow-up que já virou tarefa no mesmo dia não se repete (repasse do lead: oportunidade + tarefa)", () => {
    const days = buildAgendaDays(
      sources({
        tasks: [
          task("contato", { title: "Primeiro contato: Padaria", processType: "opportunity", processId: "o1", dueAt: "2026-11-11T13:00:00.000Z" }),
          task("lead-contato", { title: "Primeiro contato pendente: Maria", processType: "lead", processId: "l1", dueAt: "2026-11-11T14:00:00.000Z" }),
        ],
        openOpps: [
          { id: "o1", title: "Nova venda — Padaria", nextAction: "Primeiro contato", nextActionAt: "2026-11-11T13:00:00.000Z", ownerId: "u1" } as never,
          // Outro dia: o follow-up aparece.
          { id: "o2", title: "Upsell", nextAction: "Ligar", nextActionAt: "2026-11-12T13:00:00.000Z", ownerId: "u1" } as never,
        ],
        openLeads: [{ id: "l1", name: "Maria", nextActionAt: "2026-11-11T14:00:00.000Z", ownerId: "u1" } as never],
      }),
    );
    expect(days[1].items.map((i) => i.id)).toEqual(["tarefa:contato", "tarefa:lead-contato"]);
    expect(days[2].items.map((i) => i.id)).toEqual(["oportunidade:o2"]);
  });

  it("dia acima do limite: manda os pendentes primeiro e informa o total", () => {
    const many = Array.from({ length: AGENDA_DAY_MAX_ITEMS + 5 }, (_, i) =>
      task(`t${String(i).padStart(2, "0")}`, { dueAt: `2026-11-11T${String(11 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00.000Z`, status: i < 10 ? "concluida" : "aberta" }),
    );
    const day = buildAgendaDays(sources({ tasks: many }))[1];
    expect(day.total).toBe(AGENDA_DAY_MAX_ITEMS + 5);
    expect(day.items).toHaveLength(AGENDA_DAY_MAX_ITEMS);
    // Saíram 5 dos 10 feitos; nenhum pendente ficou de fora e a ordem continua por horário.
    expect(day.items.filter((i) => i.done)).toHaveLength(5);
    expect(day.items.filter((i) => !i.done)).toHaveLength(AGENDA_DAY_MAX_ITEMS + 5 - 10);
    expect(day.items.map((i) => i.at)).toEqual([...day.items.map((i) => i.at)].sort());
  });

  it("equipe mostra de quem é; item de tela que o usuário não abre fica fora da agenda", () => {
    const days = buildAgendaDays(
      sources({
        isTeam: true,
        linkable: (href) => (href.startsWith("/vendas") ? "" : href),
        tasks: [task("t1", { dueAt: "2026-11-11T12:00:00.000Z", assigneeName: "Ana" })],
        visits: [{ id: "v1", status: "agendada", scheduledAt: "2026-11-11T13:00:00.000Z", kind: "tecnica", objective: "Instalação", sellerId: "u9" } as never],
      }),
    );
    expect(days[1].items).toHaveLength(1);
    expect(days[1].items[0]).toMatchObject({ id: "tarefa:t1", assigneeName: "Ana", href: "/tarefas?tarefa=t1" });
    expect(days[1].total).toBe(1);
    const visible = buildAgendaDays(sources({ isTeam: true, visits: [{ id: "v1", status: "agendada", scheduledAt: "2026-11-11T13:00:00.000Z", kind: "tecnica", objective: "Instalação", sellerId: "u9" } as never] }));
    expect(visible[1].items[0]).toMatchObject({ id: "visita:v1", title: "Visita técnica · Instalação", assigneeName: "Pessoa u9", href: "/vendas/visitas?visita=v1" });
    // Na visão "Eu" não há dono no item.
    const mine = buildAgendaDays(sources({ visits: [{ id: "v1", status: "agendada", scheduledAt: "2026-11-11T13:00:00.000Z", kind: "comercial", objective: "X", sellerId: "u9" } as never] }));
    expect(mine[1].items[0].assigneeName).toBeUndefined();
  });
});
