"use client";

import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/domain/constants";
import type { ProcessNodeDataMap, ProcessNodeType } from "@/domain/workflow-graph";
import { NODE_KINDS } from "./node-kinds";
import type { FlowNode } from "./flow-graph";

/*
 * Blocos do canvas. Estados visuais vêm da classe do wrapper do React Flow (node.className):
 * is-current (em andamento), is-done (percorrido), is-dim (não percorrido), is-path (caminho do teste),
 * has-issue (pendência de publicação).
 */

const handleClass = "!size-2.5 !border-2 !border-canvas !bg-muted-light opacity-0 transition-opacity group-hover:opacity-100 in-[.selected]:opacity-100";

const stateRing =
  "in-[.selected]:ring-2 in-[.selected]:ring-brand in-[.selected]:ring-offset-2 in-[.selected]:ring-offset-canvas " +
  "in-[.is-current]:ring-2 in-[.is-current]:ring-brand in-[.is-current]:shadow-brand " +
  "in-[.is-done]:ring-1 in-[.is-done]:ring-success/70 in-[.is-path]:ring-2 in-[.is-path]:ring-secondary " +
  "in-[.is-dim]:opacity-45";

function IssueDot() {
  return <span className="absolute -right-1 -top-1 hidden size-3 rounded-full border-2 border-canvas bg-danger in-[.has-issue]:block" aria-hidden />;
}

function TargetHandles() {
  return (
    <>
      <Handle id="t" type="target" position={Position.Top} className={handleClass} />
      <Handle id="l" type="target" position={Position.Left} className={handleClass} />
      <Handle id="tb" type="target" position={Position.Bottom} style={{ left: "25%" }} className={handleClass} />
      <Handle id="tr" type="target" position={Position.Right} style={{ top: "25%" }} className={handleClass} />
    </>
  );
}

function SourceHandles() {
  return (
    <>
      <Handle id="b" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="r" type="source" position={Position.Right} style={{ top: "65%" }} className={handleClass} />
    </>
  );
}

function meta(type: ProcessNodeType, data: ProcessNodeDataMap[ProcessNodeType]): string | undefined {
  if (type === "tarefa") {
    const d = data as ProcessNodeDataMap["tarefa"];
    return [DEPARTMENT_LABELS[d.department], d.slaHours ? `SLA ${d.slaHours}h` : "", d.outcome === "sim_nao" ? "Sim/Não" : ""].filter(Boolean).join(" · ");
  }
  if (type === "aprovacao") return `Aprovador: ${ROLE_LABELS[(data as ProcessNodeDataMap["aprovacao"]).approverRole]}`;
  if (type === "espera") {
    const d = data as ProcessNodeDataMap["espera"];
    return d.mode === "evento" ? `Até ${d.untilEvent ?? "evento"}` : `${d.businessHours ?? 0}h úteis`;
  }
  return undefined;
}

function BoxNode({ type, data }: NodeProps<FlowNode>) {
  const kind = NODE_KINDS[type];
  const Icon = kind.icon;
  const sub = meta(type, data);
  return (
    <div className={cn("group relative flex w-[176px] items-center gap-2.5 rounded-lg border px-3 py-2.5 text-foreground shadow-card", kind.box, stateRing)}>
      <TargetHandles />
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", kind.iconBox)}>
        <Icon aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug">{data.label}</span>
        {sub ? <span className="mt-0.5 block truncate text-[11px] text-muted">{sub}</span> : null}
      </span>
      <SourceHandles />
      <IssueDot />
    </div>
  );
}

function PillNode({ type, data }: NodeProps<FlowNode>) {
  const kind = NODE_KINDS[type];
  const Icon = kind.icon;
  return (
    <div className={cn("group relative flex min-h-[56px] w-[160px] items-center gap-2.5 rounded-full border px-3 py-2 text-foreground shadow-card", kind.box, stateRing)}>
      {type === "fim" ? <TargetHandles /> : null}
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", kind.iconBox)}>
        <Icon aria-hidden />
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{data.label}</span>
      {type === "inicio" ? <SourceHandles /> : null}
      <IssueDot />
    </div>
  );
}

function ConditionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className="group relative flex size-[128px] items-center justify-center text-foreground">
      <div className={cn("absolute size-[90px] rotate-45 rounded-md border shadow-card", NODE_KINDS.condicao.box, stateRing)} aria-hidden />
      <span className="relative flex max-w-[96px] flex-col items-center text-center">
        <span className="text-lg font-bold leading-none text-warning">?</span>
        <span className="line-clamp-3 text-[12px] font-medium leading-tight">{data.label}</span>
      </span>
      <Handle id="t" type="target" position={Position.Top} className={handleClass} />
      <Handle id="l" type="target" position={Position.Left} className={handleClass} />
      <Handle id="sim" type="source" position={Position.Bottom} className={cn(handleClass, "!bg-success opacity-100")} />
      <Handle id="nao" type="source" position={Position.Right} className={cn(handleClass, "!bg-danger opacity-100")} />
      <IssueDot />
    </div>
  );
}

export const PROCESS_NODE_TYPES_MAP: NodeTypes = {
  inicio: PillNode,
  fim: PillNode,
  tarefa: BoxNode,
  aprovacao: BoxNode,
  espera: BoxNode,
  notificacao: BoxNode,
  integracao: BoxNode,
  condicao: ConditionNode,
};
