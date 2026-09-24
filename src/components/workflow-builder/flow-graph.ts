import type { CSSProperties } from "react";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
  normalizeEdgeLabel,
  type ProcessEdge,
  type ProcessNode,
  type ProcessNodeDataMap,
  type ProcessNodeType,
} from "@/domain/workflow-graph";

/** Nó do canvas: o mesmo `data` do domínio (sem campos extras, para salvar sem conversão de dados). */
export type FlowNode = Node<ProcessNodeDataMap[ProcessNodeType], ProcessNodeType>;
export type FlowEdge = Edge<{ branch?: "sim" | "nao" }>;

export const EDGE_STYLE = { stroke: "var(--color-muted-light)", strokeWidth: 1.6 };
export const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--color-muted-light)" };

export function branchLabel(branch: "sim" | "nao" | undefined): string | undefined {
  return branch === "sim" ? "Sim" : branch === "nao" ? "Não" : undefined;
}

export function toFlowEdge(e: ProcessEdge): FlowEdge {
  const branch = normalizeEdgeLabel(e.label);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? (branch ?? "b"),
    targetHandle: e.targetHandle ?? "t",
    type: "smoothstep",
    label: branchLabel(branch),
    data: { branch },
    style: EDGE_STYLE,
    markerEnd: EDGE_MARKER,
    labelStyle: { fill: "var(--color-foreground)", fontSize: 12, fontWeight: 500 },
    labelBgStyle: { fill: "var(--color-canvas)" },
    labelBgPadding: [6, 3],
  };
}

export function toFlow(nodes: ProcessNode[], edges: ProcessEdge[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }) as FlowNode),
    edges: edges.map(toFlowEdge),
  };
}

export function fromFlow(nodes: FlowNode[], edges: FlowEdge[]): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data }) as ProcessNode),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.branch,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };
}

/** Variáveis do React Flow no tema escuro do INTEROS. */
export const FLOW_THEME = {
  "--xy-background-color": "transparent",
  "--xy-edge-stroke": "var(--color-muted-light)",
  "--xy-edge-stroke-selected": "var(--color-brand)",
  "--xy-connectionline-stroke": "var(--color-brand)",
  "--xy-minimap-background-color": "var(--color-surface-muted)",
  "--xy-minimap-mask-background-color": "rgb(2 6 14 / 0.55)",
  "--xy-controls-button-background-color": "var(--color-surface)",
  "--xy-controls-button-background-color-hover": "var(--color-surface-hover)",
  "--xy-controls-button-color": "var(--color-foreground)",
  "--xy-controls-button-color-hover": "var(--color-foreground)",
  "--xy-controls-button-border-color": "var(--color-border)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;
