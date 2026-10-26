-- =====================================================================================================================
-- INTEROS — Faturamento: notas fiscais das cobranças (Fase 1).
--
-- Coleções novas:
-- - invoices: nota fiscal registrada para uma cobrança (NFS-e ou NF-e): número, série, emissão, chave/código de
--   verificação, valor, situação (emitida/cancelada) e envio ao cliente. A cobrança guarda a nota vigente (invoiceId).
-- - invoice_files: PDF e XML da nota, guardados no INTEROS (base64), servidos só por rota com permissão ou pelo token
--   do Portal do Cliente.
-- A configuração fiscal fica em settings (key "fiscal") e o perfil fiscal no próprio produto (products.fiscal).
-- Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('invoices');
select interos.create_doc_table('invoice_files');
