import type { Metadata } from "next";
import { LegalPage } from "@/components/auth/legal-page";

export const metadata: Metadata = { title: "Privacidade" };

export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de privacidade" updatedAt="24/09/2026">
      <p>
        O INTEROS é o sistema interno da Intercert. Tratamos apenas os dados necessários para operar os processos da empresa: dados cadastrais de
        colaboradores, clientes e contatos, registros de atendimento, contratos, cobranças e indicadores de desempenho.
      </p>
      <h2>Finalidade e base legal</h2>
      <p>
        Os dados são usados para executar contratos, cumprir obrigações legais e atender ao legítimo interesse da Intercert na gestão comercial,
        financeira e de suporte, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Leads só são contatados com consentimento registrado.
      </p>
      <h2>Acesso e segurança</h2>
      <p>
        O acesso é restrito a colaboradores autorizados, com perfis por função. As informações ficam em infraestrutura de nuvem com criptografia em
        trânsito, e toda alteração relevante fica registrada na linha do tempo e na auditoria do sistema.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Titulares podem solicitar confirmação, acesso, correção, anonimização ou exclusão dos seus dados pelo e-mail do encarregado de dados da
        Intercert, por meio do administrador do sistema.
      </p>
    </LegalPage>
  );
}
