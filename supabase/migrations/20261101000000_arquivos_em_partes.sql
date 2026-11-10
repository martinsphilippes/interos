-- =====================================================================================================================
-- INTEROS — Arquivos guardados em partes (primeiro uso: comprovantes do consentimento LGPD do lead).
--
-- Coleções novas:
-- - stored_files: um documento por arquivo — dono (ownerKind + ownerId), nome, tipo, tamanho, SHA-256, situação
--   (enviando, ativo, removido), quem enviou, miniatura e o registro da remoção (quem, quando e por quê).
-- - stored_file_chunks: o conteúdo em partes de 2 MB (base64), id `<arquivo>__<nº da parte>`. Partes porque cada
--   requisição/resposta de função na Vercel tem limite de ~4,5 MB; remover um arquivo apaga as partes.
-- Aditiva: não altera nem apaga dados. Como as demais coleções, só o papel interos_app tem acesso (nada exposto a
-- anon/authenticated nem link público).
-- =====================================================================================================================

select interos.create_doc_table('stored_files');
select interos.create_doc_table('stored_file_chunks');
