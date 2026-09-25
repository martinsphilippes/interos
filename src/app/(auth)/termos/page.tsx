import type { Metadata } from "next";
import { LegalPage } from "@/components/auth/legal-page";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermosPage() {
  return (
    <LegalPage title="Termos de uso" updatedAt="24/09/2026">
      <p>
        O INTEROS é de uso exclusivo de colaboradores e parceiros autorizados pela Intercert. Ao entrar, você concorda em usar o sistema apenas para as
        atividades da sua função.
      </p>
      <h2>Conta e credenciais</h2>
      <p>
        Suas credenciais são pessoais e intransferíveis. Mantenha sua senha em sigilo e avise o administrador imediatamente em caso de suspeita de uso
        indevido. Contas inativas podem ser desativadas pelo administrador.
      </p>
      <h2>Uso das informações</h2>
      <p>
        Dados de clientes, contratos e indicadores são confidenciais. É proibido exportar, copiar ou compartilhar informações fora das finalidades de
        trabalho. As ações realizadas no sistema ficam registradas para auditoria.
      </p>
      <h2>Disponibilidade</h2>
      <p>
        A Intercert trabalha para manter o sistema disponível e seguro, podendo realizar manutenções programadas. Dúvidas sobre estes termos devem ser
        enviadas ao administrador do sistema.
      </p>
    </LegalPage>
  );
}
