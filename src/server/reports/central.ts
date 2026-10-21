import "server-only";
/**
 * Relatórios da Central de Atendimento (fase 4): atendimentos por fila (conversas e ligações) e ligações com custo
 * estimado. Mesmo contrato dos demais relatórios operacionais (linhas, filtros, escopo da tela Relatórios).
 */
import { col, ORG_ID } from "@/server/db";
import { COLLECTIONS, type BaseEntity, type CollectionName, type Communication, type Conversation, type ServiceQueue, type User } from "@/domain/types";
import { CALL_STATUS_LABELS, callCost, callStatusOf } from "@/domain/telephony";
import { firstResponseMs } from "@/domain/conversation-history";
import { displayPhone } from "@/domain/phone";
import type { Period } from "@/server/kpis/period";
import { getPabx } from "@/server/telephony/service";
import type { ReportFilters, ReportValue } from "./definitions";

export interface CentralReportInput {
  period: Pick<Period, "start" | "end">;
  filters: ReportFilters;
  userById: Map<string, User>;
  clientName: (id: string | undefined) => string | null;
  inScope: (owners: readonly (string | undefined | null)[]) => boolean;
}

interface Row {
  cells: Record<string, ReportValue>;
  href?: string;
}

async function inRange<T extends BaseEntity>(name: CollectionName, field: string, period: Pick<Period, "start" | "end">): Promise<T[]> {
  const snap = await col(name).where("organizationId", "==", ORG_ID).where(field, ">=", period.start).where(field, "<", period.end).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<T, "id">), id: d.id }) as T);
}

async function queues(): Promise<ServiceQueue[]> {
  const snap = await col(COLLECTIONS.serviceQueues).where("organizationId", "==", ORG_ID).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<ServiceQueue, "id">), id: d.id }) as ServiceQueue);
}

const avg = (values: number[]): number | null => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/**
 * Atendimentos por fila no período: conversas recebidas, atendidas, encerradas sem resposta, 1ª resposta e tempo de
 * atendimento médios; ligações recebidas, perdidas e duração média. Linha «Sem fila» para o que não tem fila.
 */
export async function buildAttendanceByQueue({ period, filters, inScope }: CentralReportInput): Promise<Row[]> {
  const [convs, calls, qs] = await Promise.all([inRange<Conversation>(COLLECTIONS.conversations, "openedAt", period), inRange<Communication>(COLLECTIONS.communications, "createdAt", period), queues()]);
  const visibleConvs = convs.filter((c) => inScope([c.assigneeId]) && (!filters.colaborador || c.assigneeId === filters.colaborador));
  const visibleCalls = calls.filter((c) => c.channel === "voip" && c.direction === "entrada" && inScope([c.userId]) && (!filters.colaborador || c.userId === filters.colaborador));
  const keys = new Map<string, string>([...qs.map((q) => [q.id, q.name] as [string, string]), ["", "Sem fila"]]);
  const rows: Row[] = [];
  for (const [id, name] of keys) {
    const cv = visibleConvs.filter((c) => (c.queueId ?? "") === id || (id === "" && c.queueId && !keys.has(c.queueId)));
    const cl = visibleCalls.filter((c) => (c.queueId ?? "") === id || (id === "" && c.queueId && !keys.has(c.queueId)));
    if (!cv.length && !cl.length) continue;
    const answered = cv.filter((c) => c.firstResponseAt);
    const closed = cv.filter((c) => c.closedAt);
    const firstResponse = answered.map((c) => firstResponseMs(c)).filter((v): v is number => v !== undefined).map((ms) => ms / 60_000);
    const handle = closed.map((c) => (new Date(c.closedAt!).getTime() - new Date(c.openedAt).getTime()) / 60_000).filter((v) => Number.isFinite(v) && v >= 0);
    const callsAnswered = cl.filter((c) => callStatusOf(c) === "atendida");
    const callsMissed = cl.filter((c) => callStatusOf(c) === "perdida");
    rows.push({
      cells: {
        fila: name,
        conversas: cv.length,
        atendidas: answered.length,
        encerradas: closed.length,
        sem_resposta: closed.filter((c) => c.closeReason === "sem_resposta").length,
        primeira_resposta: round1(avg(firstResponse)),
        atendimento_medio: round1(avg(handle)),
        ligacoes: cl.length,
        ligacoes_perdidas: callsMissed.length,
        perdidas_pct: cl.length ? callsMissed.length / cl.length : null,
        duracao_media: round1(avg(callsAnswered.map((c) => (c.durationSeconds ?? 0) / 60))),
      },
    });
  }
  return rows.sort((a, b) => Number(b.cells.conversas ?? 0) + Number(b.cells.ligacoes ?? 0) - (Number(a.cells.conversas ?? 0) + Number(a.cells.ligacoes ?? 0)));
}

/** Ligações do período (pelo provedor e registradas à mão) com resultado, duração e custo estimado pelas tarifas do PABX. */
export async function buildCalls({ period, filters, userById, clientName, inScope }: CentralReportInput): Promise<{ rows: Row[]; ratesConfigured: boolean }> {
  const [all, qs, pabx] = await Promise.all([inRange<Communication>(COLLECTIONS.communications, "createdAt", period), queues(), getPabx()]);
  const qName = new Map(qs.map((q) => [q.id, q.name]));
  const rows = all
    .filter((c) => c.channel === "voip")
    .filter((c) => inScope([c.userId]))
    .filter((c) => !filters.colaborador || c.userId === filters.colaborador)
    .filter((c) => !filters.cliente || c.clientId === filters.cliente)
    .filter((c) => !filters.status || callStatusOf(c) === filters.status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((c) => {
      const number = (c.direction === "entrada" ? c.fromNumber : c.toNumber) ?? c.address;
      return {
        cells: {
          quando: c.createdAt,
          direcao: c.direction === "entrada" ? "Recebida" : "Feita",
          numero: displayPhone(number) || number || null,
          cliente: clientName(c.clientId),
          atendente: (c.userId && userById.get(c.userId)?.name) || null,
          fila: c.queueId ? (qName.get(c.queueId) ?? null) : null,
          resultado: c.voicemail ? "Recado" : CALL_STATUS_LABELS[callStatusOf(c)],
          origem: c.provider === "twilio" ? "Provedor" : "Registro manual",
          duracao: Math.round(((c.durationSeconds ?? 0) / 60) * 10) / 10,
          custo: callCost(c, pabx.rates),
        },
        href: "/comunicacao/ligacoes",
      };
    });
  return { rows, ratesConfigured: Object.values(pabx.rates).some((v) => v > 0) };
}
