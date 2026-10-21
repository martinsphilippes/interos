-- =====================================================================================================================
-- INTEROS — Assinatura eletrônica (Clicksign), primeira entrega: modelos de contrato e caixa de entrada.
--
-- Coleções novas:
-- - contract_templates: modelos de contrato (texto gerado pelo INTEROS ou Word usado na Clicksign), com as variáveis
--   ligadas aos campos do contrato;
-- - contract_template_files: o arquivo Word de cada versão do modelo (imutável: o contrato aponta para a versão usada);
-- - signature_inbox: documentos criados direto na Clicksign, à espera do cliente certo.
-- Índices: modelo padrão e arquivos por modelo; caixa de entrada por situação.
-- Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('contract_templates');
select interos.create_doc_table('contract_template_files');
select interos.create_doc_table('signature_inbox');

create index if not exists contract_template_files_template_idx on interos.contract_template_files ((data->>'templateId'));
create index if not exists signature_inbox_state_idx on interos.signature_inbox ((data->>'state'));
