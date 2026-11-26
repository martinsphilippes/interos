-- =====================================================================================================================
-- INTEROS — Gestão de Produtos (fases 7 e 8 da Central de Produtos): camada comercial por cima do catálogo do ERP.
--
-- Coleções novas:
-- - product_modules: ficha comercial de cada unidade comercial do catálogo do ERP (id = código da unidade, ex.: 07.01):
--   nome comercial, texto para proposta, situação (em definição, à venda, sob consulta, descontinuado), segmentos,
--   dependências comerciais, observações e as versões de preço (modelo, valores, implantação, início de vigência,
--   motivo, quem criou; versão cancelada fica no histórico).
-- - product_packages: pacotes comerciais por segmento com as versões (módulos incluídos, mensalidade e implantação por
--   vigência). O que está no pacote não é cobrado de novo como avulso.
-- Aditiva: não altera nem apaga dados. Como as demais coleções, só o papel interos_app tem acesso (nada exposto a
-- anon/authenticated).
-- =====================================================================================================================

select interos.create_doc_table('product_modules');
select interos.create_doc_table('product_packages');
