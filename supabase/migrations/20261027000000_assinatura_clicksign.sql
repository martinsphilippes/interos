-- =====================================================================================================================
-- INTEROS — Assinatura eletrônica (Clicksign), integração pela API: PDF assinado guardado no INTEROS.
--
-- Coleção nova:
-- - signed_files: o PDF assinado que a Clicksign devolve ao finalizar (do contrato ou de um documento da caixa de
--   entrada). Os links da Clicksign expiram; o arquivo fica aqui como registro permanente.
-- Índice: arquivos por dono (contrato/documento da caixa de entrada).
-- Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('signed_files');

create index if not exists signed_files_owner_idx on interos.signed_files ((data->>'ownerId'));
