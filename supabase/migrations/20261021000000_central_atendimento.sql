-- =====================================================================================================================
-- INTEROS — Central de Atendimento (módulo Comunicação), fase 1.
--
-- Coleções novas (mesmo modelo de documento do resto do sistema; RLS e grants pela create_doc_table):
-- - conversations: uma conversa por canal + contato enquanto aberta (fila, responsável, status, janela de 24 h, SLA);
-- - service_queues: filas de atendimento;
-- - channel_events: registros técnicos dos avisos dos provedores (guardados por 30 dias);
-- - message_templates: modelos do WhatsApp aprovados pela Meta (sincronizados);
-- - quick_replies: respostas rápidas da Central.
-- As mensagens continuam em `communications` (ganham `conversationId`); nada é duplicado.
--
-- Índices de expressão para as consultas da Central (o GIN de `data` já atende igualdade; estes evitam varrer a
-- coleção inteira quando ela crescer).
-- =====================================================================================================================

select interos.create_doc_table('conversations');
select interos.create_doc_table('service_queues');
select interos.create_doc_table('channel_events');
select interos.create_doc_table('message_templates');
select interos.create_doc_table('quick_replies');

create index if not exists conversations_contact_idx on interos.conversations ((data->>'channel'), (data->>'contactKey'));
create index if not exists conversations_status_idx on interos.conversations ((data->>'status'));
create index if not exists communications_conversation_idx on interos.communications ((data->>'conversationId'));
create index if not exists communications_external_idx on interos.communications ((data->>'externalId'));
create index if not exists channel_events_occurred_idx on interos.channel_events ((data->>'occurredAt'));
