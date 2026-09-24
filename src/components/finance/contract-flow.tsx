import { Check, FileSignature, Rocket, Send, Wallet, type LucideIcon } from "lucide-react";
import type { Billing, Contract } from "@/domain/types";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "todo" | "blocked";

interface FlowStep {
  key: string;
  label: string;
  icon: LucideIcon;
  state: StepState;
  hint?: string;
}

/** Passos visuais: Gerar contrato → Enviar para assinatura → Assinado → Cobrança/pagamento → Liberado. */
export function buildFlow(contract: Contract, billings: Billing[], paymentOk: boolean): FlowStep[] {
  const released = contract.status === "liberado";
  const sent = Boolean(contract.signatureEnvelopeId) || released;
  const signedCount = contract.signers.filter((s) => s.status === "assinado").length;
  const signed = released || (sent && contract.signers.length > 0 && signedCount === contract.signers.length);
  const billed = billings.some((b) => b.status !== "cancelada");
  const ready = contract.items.length > 0 && contract.signers.length > 0;
  const pending = contract.status === "pendencia";

  const states: StepState[] = [ready || sent ? "done" : "current", sent ? "done" : "todo", signed ? "done" : "todo", released || (billed && paymentOk) ? "done" : "todo", released ? "done" : "todo"];
  // O primeiro passo não concluído é o atual (ou bloqueado, se há pendência).
  const current = states.findIndex((s) => s !== "done");
  if (current >= 0) states[current] = pending ? "blocked" : "current";

  return [
    { key: "gerar", label: "Gerar contrato", icon: FileSignature, state: states[0], hint: ready ? `${contract.items.length} item(ns) · ${contract.signers.length} signatário(s)` : "Itens e signatários" },
    { key: "enviar", label: "Enviar para assinatura", icon: Send, state: states[1], hint: sent ? `v${contract.version}` : undefined },
    { key: "assinado", label: "Assinado", icon: Check, state: states[2], hint: contract.signers.length > 0 ? `${signedCount}/${contract.signers.length}` : undefined },
    { key: "pagamento", label: "Cobrança / pagamento", icon: Wallet, state: states[3], hint: billed ? (paymentOk ? "Pagamento exigido ok" : "Aguardando pagamento") : "Cobranças não geradas" },
    { key: "liberado", label: "Liberado", icon: Rocket, state: states[4], hint: released ? "Implantação iniciada" : undefined },
  ];
}

const circle: Record<StepState, string> = {
  done: "border-success bg-success-strong text-white",
  current: "border-brand bg-brand-soft text-brand-fg",
  blocked: "border-danger bg-danger-soft text-danger-fg",
  todo: "border-border-strong bg-surface-muted text-muted-light",
};

export function ContractFlow({ steps, className }: { steps: FlowStep[]; className?: string }) {
  return (
    <ol className={cn("grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-0", className)} aria-label="Fluxo do contrato">
      {steps.map((step, i) => {
        const Icon = step.state === "done" ? Check : step.icon;
        return (
          <li key={step.key} className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:text-center" aria-current={step.state === "current" ? "step" : undefined}>
            {i > 0 ? <span className={cn("absolute top-5 right-1/2 hidden h-0.5 w-full sm:block", steps[i - 1].state === "done" ? "bg-success" : "bg-border")} aria-hidden /> : null}
            <span className={cn("relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 [&_svg]:size-4", circle[step.state])}>
              <Icon aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col sm:mt-2">
              <span className={cn("text-sm font-medium", step.state === "todo" ? "text-muted" : "text-foreground")}>{step.label}</span>
              {step.hint ? <span className={cn("text-xs", step.state === "blocked" ? "text-danger-fg" : "text-muted")}>{step.state === "blocked" ? "Pendência" : step.hint}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
