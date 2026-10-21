-- =====================================================================================================================
-- INTEROS — Central de Atendimento, fase 5: novos canais (Instagram, Messenger, Telegram e chat do site).
--
-- Coleções novas:
-- - channel_connections: canais conectados pela tela (página da Meta, bot do Telegram), com o token CIFRADO
--   (AES-256-GCM no servidor; a chave nunca está no banco);
-- - chat_visitors: visitantes do chat do site (nome e contato informados, hash do IP para o limite de uso).
-- Índice: visitantes por hash do IP (limite de novas sessões).
-- Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('channel_connections');
select interos.create_doc_table('chat_visitors');

create index if not exists chat_visitors_ip_idx on interos.chat_visitors ((data->>'ipHash'));
