-- =====================================================================================================================
-- INTEROS — Integração com o ERP Intercert: vínculo das empresas, catálogo de módulos, licença e operações.
--
-- Coleções novas:
-- - erp_links: vínculo cliente do INTEROS ↔ empresa no ERP (id ERP, CNPJ, ambiente, como foi vinculado). No máximo um
--   vínculo ativo por cliente e por empresa do ERP em cada ambiente (garantido em transação no servidor).
-- - erp_catalogs: cada versão importada do catálogo técnico do ERP (módulos, submódulos e recursos, com códigos,
--   dependências e disponibilidade) e a diferença para a versão anterior (novos, alterados, retirados).
-- - erp_licenses: a licença que o INTEROS contratou para cada empresa vinculada (itens, versão emitida e a última
--   versão confirmada pelo ERP).
-- - erp_change_requests: cada alteração enviada ao ERP (licença, provisionamento, vínculo): pedido, estado anterior e
--   novo, quem pediu, motivo, simulação, tentativas, resposta e referência da operação no ERP. O id é também a chave
--   de idempotência: repetir nunca duplica.
-- Aditiva: não altera nem apaga dados. Como as demais coleções, só o papel interos_app tem acesso (nada exposto a
-- anon/authenticated).
-- =====================================================================================================================

select interos.create_doc_table('erp_links');
select interos.create_doc_table('erp_catalogs');
select interos.create_doc_table('erp_licenses');
select interos.create_doc_table('erp_change_requests');
