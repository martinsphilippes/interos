"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { AlertTriangle, Activity, GripVertical, History, Play, Rocket, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { cn, shortId } from "@/lib/utils";
import {
  PROCESS_NODE_LABELS,
  PROCESS_NODE_TYPES,
  PROCESS_STATUS_LABELS,
  defaultNodeData,
  nodeHasOutcome,
  validateProcessGraph,
  type ProcessNode,
  type ProcessNodeDataMap,
  type ProcessNodeType,
} from "@/domain/workflow-graph";
import { publishProcessDefinitionAction, saveProcessDefinitionAction } from "@/server/process-engine/actions";
import type { BuilderData } from "@/server/process-engine/queries";
import type { GraphInput } from "@/server/process-engine/schemas";
import type { SimulationResult } from "@/server/process-engine/simulate";
import { NODE_KINDS, NODE_MINIMAP_COLOR } from "./node-kinds";
import { PROCESS_NODE_TYPES_MAP } from "./flow-nodes";
import { EDGE_STYLE, FLOW_THEME, branchLabel, fromFlow, toFlow, toFlowEdge, type FlowEdge, type FlowNode } from "./flow-graph";
import { PropertiesPanel, type ProcessMeta } from "./properties-panel";
import { TestFlowDialog } from "./test-flow-dialog";

const DND_TYPE = "application/x-interos-node";


export function ProcessBuilder(props: { data: BuilderData; webhooksEnabled: boolean }) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function statusBadge(status: keyof typeof PROCESS_STATUS_LABELS) {
  const tone = status === "publicado" ? "bg-success" : status === "rascunho" ? "bg-warning" : "bg-muted-light";
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3 text-sm" data-testid="process-status">
      <span className={cn("size-2 rounded-full", tone)} aria-hidden /> {PROCESS_STATUS_LABELS[status]}
    </span>
  );
}

function Builder({ data, webhooksEnabled }: { data: BuilderData; webhooksEnabled: boolean }) {
  const router = useRouter();
  const def = data.definition;
  const initial = React.useMemo(() => toFlow(def.nodes, def.edges), [def]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<FlowEdge>(initial.edges);
  const [meta, setMeta] = React.useState<ProcessMeta>({ name: def.name, description: def.description, trigger: def.trigger });
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [simulation, setSimulation] = React.useState<SimulationResult | null>(null);
  const [saving, startSaving] = React.useTransition();
  const [publishing, startPublishing] = React.useTransition();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapper = React.useRef<HTMLDivElement>(null);

  const graph = React.useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const issues = React.useMemo(() => validateProcessGraph({ ...graph, name: meta.name, trigger: meta.trigger }), [graph, meta]);
  const issueNodes = React.useMemo(() => new Set(issues.flatMap((i) => (i.nodeId ? [i.nodeId] : []))), [issues]);

  // Classes de estado aplicadas no wrapper do nó (pendência, caminho do teste).
  const pathNodes = React.useMemo(() => new Set(simulation?.pathNodeIds ?? []), [simulation]);
  const pathEdges = React.useMemo(() => new Set(simulation?.pathEdgeIds ?? []), [simulation]);
  const viewNodes = React.useMemo(
    () => nodes.map((n) => ({ ...n, className: cn(issueNodes.has(n.id) && "has-issue", simulation && (pathNodes.has(n.id) ? "is-path" : "is-dim")) || undefined })),
    [nodes, issueNodes, simulation, pathNodes],
  );
  const viewEdges = React.useMemo(
    () =>
      simulation
        ? edges.map((e) => (pathEdges.has(e.id) ? { ...e, animated: true, style: { ...EDGE_STYLE, stroke: "var(--color-secondary)", strokeWidth: 2.2 } } : { ...e, style: { ...EDGE_STYLE, opacity: 0.35 } }))
        : edges,
    [edges, simulation, pathEdges],
  );

  const onNodesChange = React.useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((c) => c.type === "position" || c.type === "remove" || c.type === "add")) setDirty(true);
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase],
  );
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (changes.some((c) => c.type === "remove" || c.type === "add")) setDirty(true);
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase],
  );

  const onConnect = React.useCallback(
    (c: Connection) => {
      const source = nodes.find((n) => n.id === c.source);
      const branch = source?.type === "condicao" && (c.sourceHandle === "sim" || c.sourceHandle === "nao") ? c.sourceHandle : undefined;
      setEdges((eds) => {
        // Uma condição tem uma única saída por ramo: religar substitui a anterior.
        const filtered = branch ? eds.filter((e) => !(e.source === c.source && e.data?.branch === branch)) : eds;
        return addEdge(toFlowEdge({ id: `e_${shortId()}`, source: c.source, target: c.target, label: branch, sourceHandle: c.sourceHandle ?? undefined, targetHandle: c.targetHandle ?? undefined }), filtered);
      });
      setDirty(true);
    },
    [nodes, setEdges],
  );

  const addNode = React.useCallback(
    (type: ProcessNodeType, position?: { x: number; y: number }) => {
      let pos = position;
      if (!pos) {
        const rect = wrapper.current?.getBoundingClientRect();
        pos = rect ? screenToFlowPosition({ x: rect.left + rect.width / 2 - 90, y: rect.top + rect.height / 2 - 30 }) : { x: 0, y: 0 };
      }
      const id = `${type}_${shortId()}`;
      const node = { id, type, position: pos, data: defaultNodeData(type), selected: true } as FlowNode;
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setDirty(true);
      return id;
    },
    [screenToFlowPosition, setNodes],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DND_TYPE) as ProcessNodeType;
      if (!(PROCESS_NODE_TYPES as readonly string[]).includes(type)) return;
      addNode(type, screenToFlowPosition({ x: event.clientX - 90, y: event.clientY - 28 }));
    },
    [addNode, screenToFlowPosition],
  );

  const updateNodeData = React.useCallback(
    (id: string, patch: Partial<ProcessNodeDataMap[ProcessNodeType]>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as FlowNode) : n)));
      setDirty(true);
    },
    [setNodes],
  );

  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
    setDirty(true);
  };
  const deleteEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id));
    setSelectedEdgeId(null);
    setDirty(true);
  };
  const setEdgeBranch = (id: string, branch: "sim" | "nao" | undefined) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { branch }, label: branchLabel(branch) } : e)));
    setDirty(true);
  };

  /** "Adicionar regra": insere uma Condição logo abaixo da etapa, herdando as saídas dela pelo ramo Sim. */
  const addRule = (sourceId: string) => {
    const source = nodes.find((n) => n.id === sourceId);
    if (!source) return;
    const id = `condicao_${shortId()}`;
    const data: ProcessNodeDataMap["condicao"] = nodeHasOutcome({ id: source.id, type: source.type, position: source.position, data: source.data } as ProcessNode)
      ? { label: (source.data as ProcessNodeDataMap["tarefa"]).outcomeQuestion || `${source.data.label}?`, mode: "resultado", fromNode: source.id }
      : { label: "Condição?", mode: "contexto", path: "entity.status", operator: "==", value: "" };
    const outgoing = edges.filter((e) => e.source === sourceId);
    setNodes((ns) => [
      ...ns.map((n) => (n.position.y > source.position.y + 40 ? { ...n, position: { ...n.position, y: n.position.y + 170 } } : { ...n, selected: false })),
      { id, type: "condicao", position: { x: source.position.x + 30, y: source.position.y + 110 }, data, selected: true } as FlowNode,
    ]);
    setEdges((es) => [
      ...es.filter((e) => e.source !== sourceId),
      toFlowEdge({ id: `e_${shortId()}`, source: sourceId, target: id, sourceHandle: "b", targetHandle: "t" }),
      ...outgoing.map((e) => toFlowEdge({ id: e.id, source: id, target: e.target, label: "sim", sourceHandle: "sim", targetHandle: e.targetHandle ?? "t" })),
    ]);
    setSelectedNodeId(id);
    setDirty(true);
  };

  const getGraph = React.useCallback((): GraphInput => ({ name: meta.name, description: meta.description, trigger: meta.trigger, nodes: graph.nodes, edges: graph.edges }), [meta, graph]);

  const save = (then?: (id: string) => void) =>
    startSaving(async () => {
      const res = await saveProcessDefinitionAction({ id: def.id, ...getGraph() });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDirty(false);
      if (then) return then(res.data.id);
      if (res.data.created) {
        toast.success(`Versão v${res.data.version} criada como rascunho`);
        router.push(`/admin/workflows/processos/${res.data.id}`);
      } else {
        toast.success("Rascunho salvo");
        router.refresh();
      }
    });

  const publish = () => {
    if (issues.length > 0) {
      toast.error(`Corrija ${issues.length} pendência(s) antes de publicar`);
      return;
    }
    const doPublish = (id: string) =>
      startPublishing(async () => {
        const res = await publishProcessDefinitionAction({ id });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Versão v${res.data.version} publicada`);
        if (id !== def.id) router.push(`/admin/workflows/processos/${id}`);
        else router.refresh();
      });
    if (dirty || def.status !== "rascunho") save(doPublish);
    else doPublish(def.id);
  };

  const navigate = (href: string) => {
    if (dirty && !window.confirm("Há alterações não salvas. Sair mesmo assim?")) return;
    router.push(href);
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const decisions = nodes
    .filter((n) => nodeHasOutcome({ id: n.id, type: n.type, position: n.position, data: n.data } as ProcessNode))
    .map((n) => ({ id: n.id, label: n.data.label, question: n.type === "aprovacao" ? `${n.data.label}: aprovar?` : (n.data as ProcessNodeDataMap["tarefa"]).outcomeQuestion }));
  const canPublish = def.status === "rascunho" || dirty;

  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-[28px]">Construtor de Workflows</h1>
          <p className="text-sm text-muted">Crie e automatize processos sem precisar programar</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-muted sm:flex-none">
            Workflow
            <Select value={def.id} onChange={(e) => navigate(e.target.value === "__jornada" ? "/admin/workflows" : `/admin/workflows/processos/${e.target.value}`)} aria-label="Workflow">
              {data.processes.map((p) => (
                <option key={p.id} value={p.key === def.key ? def.id : p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__jornada">Jornada do cliente (editor em lista)</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Versão
            <Select value={def.id} onChange={(e) => navigate(`/admin/workflows/processos/${e.target.value}`)} aria-label="Versão" className="w-[132px]">
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Versão {v.version}
                </option>
              ))}
            </Select>
          </label>
          {statusBadge(def.status)}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link href={`/admin/workflows/processos/${def.id}/execucoes`} className="inline-flex min-h-[36px] items-center gap-1.5 text-secondary-fg hover:underline">
            <Activity className="size-4" /> Execuções ({data.runCount})
          </Link>
          <button type="button" onClick={() => setVersionsOpen(true)} className="inline-flex min-h-[36px] items-center gap-1.5 text-secondary-fg hover:underline">
            <History className="size-4" /> Histórico de versões
          </button>
          {dirty ? <Badge variant="warning">Alterações não salvas</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {issues.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="text-warning-fg">
                  <AlertTriangle /> {issues.length} pendência(s)
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <p className="mb-2 text-sm font-medium">Para publicar, corrija:</p>
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
                  {issues.map((i, idx) => (
                    <li key={`${i.message}-${idx}`}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-muted hover:bg-surface-hover hover:text-foreground"
                        onClick={() => {
                          if (!i.nodeId) return;
                          setSelectedNodeId(i.nodeId);
                          setSelectedEdgeId(null);
                          fitView({ nodes: [{ id: i.nodeId }], duration: 300, maxZoom: 1.2 });
                        }}
                      >
                        {i.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
          <Button variant="outline" onClick={() => save()} loading={saving && !publishing}>
            {saving ? null : <Save />} {def.status === "rascunho" ? "Salvar" : "Salvar nova versão"}
          </Button>
          <Button variant="outline" onClick={() => setTestOpen(true)}>
            <Play /> Testar fluxo
          </Button>
          <Button onClick={publish} loading={publishing} disabled={!canPublish} title={canPublish ? undefined : "Esta versão já está publicada"}>
            {publishing ? null : <Rocket />} Publicar
          </Button>
        </div>
      </div>

      {/* Área de trabalho: paleta · canvas · propriedades */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--spacing-topbar)-200px)] lg:min-h-[600px] lg:grid-cols-[180px_minmax(0,1fr)_330px]">
        <aside className="flex flex-col rounded-xl border border-border bg-surface p-3 lg:overflow-y-auto" aria-label="Blocos">
          <h2 className="mb-2 px-1 text-sm font-semibold">Blocos</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin lg:flex-col lg:overflow-visible lg:pb-0">
            {PROCESS_NODE_TYPES.map((type) => {
              const kind = NODE_KINDS[type];
              const Icon = kind.icon;
              return (
                <li key={type} className="shrink-0">
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => addNode(type)}
                    className="flex min-h-[48px] w-full cursor-grab items-center gap-2 rounded-lg border border-border bg-surface-muted px-2.5 py-2 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-hover active:cursor-grabbing"
                    title={`Arraste para o canvas ou clique para adicionar: ${PROCESS_NODE_LABELS[type]}`}
                    data-testid={`palette-${type}`}
                  >
                    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5", kind.iconBox, type === "condicao" && "rotate-45 rounded-sm [&_svg]:-rotate-45")}>
                      <Icon aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{PROCESS_NODE_LABELS[type]}</span>
                    <GripVertical className="hidden size-4 shrink-0 text-muted-light lg:block" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto hidden pt-3 lg:block">
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => NODE_MINIMAP_COLOR[(n.type as ProcessNodeType) ?? "tarefa"]}
              nodeBorderRadius={4}
              style={{ position: "static", margin: 0, width: 154, height: 110, ...FLOW_THEME }}
              className="!m-0 overflow-hidden rounded-lg border border-border"
              ariaLabel="Minimapa"
            />
          </div>
        </aside>

        <div
          ref={wrapper}
          className="relative h-[62vh] min-h-[420px] overflow-hidden rounded-xl border border-border bg-canvas lg:h-auto"
          style={FLOW_THEME}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={onDrop}
          data-testid="process-canvas"
        >
          <ReactFlow<FlowNode, FlowEdge>
            nodes={viewNodes}
            edges={viewEdges}
            nodeTypes={PROCESS_NODE_TYPES_MAP}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedNodeId(n.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, e) => {
              setSelectedEdgeId(e.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onNodesDelete={() => setSelectedNodeId(null)}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={2}
            snapToGrid
            snapGrid={[10, 10]}
            deleteKeyCode={["Backspace", "Delete"]}
            attributionPosition="top-right"
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(148 163 186 / 0.18)" />
            <Controls position="bottom-left" showInteractive className="!rounded-lg !border !border-border [&_button]:!size-8" aria-label="Zoom e centralizar" />
            <ZoomBadge />
          </ReactFlow>
          {simulation ? (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-secondary/40 bg-surface/95 px-3 py-1.5 text-xs shadow-pop">
              <span className="size-2 rounded-full bg-secondary" /> Caminho do teste com {simulation.client.name}
              <button type="button" className="ml-1 text-secondary-fg hover:underline" onClick={() => setSimulation(null)}>
                limpar
              </button>
            </div>
          ) : null}
        </div>

        <aside className="rounded-xl border border-border bg-surface lg:overflow-hidden" aria-label="Propriedades">
          <PropertiesPanel
            node={selectedNode}
            edge={selectedEdge}
            nodes={nodes}
            meta={meta}
            users={data.users}
            issues={issues}
            webhooksEnabled={webhooksEnabled}
            onMetaChange={(patch) => {
              setMeta((m) => ({ ...m, ...patch }));
              setDirty(true);
            }}
            onNodeChange={updateNodeData}
            onEdgeBranch={setEdgeBranch}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onAddRule={addRule}
            onClose={selectedNode || selectedEdge ? () => (setSelectedNodeId(null), setSelectedEdgeId(null)) : undefined}
          />
        </aside>
      </div>

      <TestFlowDialog open={testOpen} onOpenChange={setTestOpen} clients={data.clients} decisions={decisions} getGraph={getGraph} onResult={setSimulation} />

      <Drawer open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DrawerContent size="sm">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <History className="size-5" /> Histórico de versões
            </DrawerTitle>
            <DrawerDescription>Versões publicadas são imutáveis. Editar uma publicada cria a próxima versão como rascunho; execuções continuam na versão em que começaram.</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <ul className="flex flex-col gap-2">
              {data.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setVersionsOpen(false);
                      navigate(`/admin/workflows/processos/${v.id}`);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover",
                      v.id === def.id ? "border-brand/60 bg-brand-soft" : "border-border bg-surface",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-medium">Versão {v.version}</span>
                      <span className="block text-xs text-muted">
                        {v.publishedAt ? `Publicada em ${formatDateTime(v.publishedAt)}${v.publishedByName ? ` por ${v.publishedByName}` : ""}` : `Atualizada em ${formatDateTime(v.updatedAt)}`}
                      </span>
                    </span>
                    <Badge size="sm" variant={v.status === "publicado" ? "success" : v.status === "rascunho" ? "warning" : "muted"}>
                      {PROCESS_STATUS_LABELS[v.status]}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/** Indicador de zoom como na referência ("100%"). */
function ZoomBadge() {
  const { zoom } = useViewport();
  return (
    <div className="pointer-events-none absolute bottom-3 left-14 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs tabular-nums text-muted">
      {Math.round(zoom * 100)}%
    </div>
  );
}
