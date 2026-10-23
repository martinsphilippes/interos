-- =====================================================================================================================
-- INTEROS — Índices de reajuste (IPCA, IGP-M, INPC, IGP-DI, ICTI e os cadastrados) e reajuste anual dos contratos.
--
-- Coleção nova:
-- - readjustment_indices: cadastro dos índices (fonte: série SGS do Banco Central, planilha do ICTI no IPEA ou
--   manual) com a variação de cada mês (`values`, AAAA-MM → %). Os 5 índices padrão são criados pelo INTEROS na
--   primeira leitura (ids fixos "ipca", "igpm", "inpc", "igpdi", "icti"). O acumulado de 12 meses é calculado.
-- Aditiva: não altera nem apaga dados (os contratos ganham `readjustmentLog` só quando um reajuste é decidido).
-- =====================================================================================================================

select interos.create_doc_table('readjustment_indices');
