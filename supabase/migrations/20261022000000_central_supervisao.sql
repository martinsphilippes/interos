-- =====================================================================================================================
-- INTEROS — Central de Atendimento, fase 2 (supervisão digital).
--
-- supervision_logs: registro de supervisão (quem acompanhou, sussurrou, assumiu ou escalou qual conversa, e por quanto
-- tempo). Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('supervision_logs');

create index if not exists supervision_logs_conversation_idx on interos.supervision_logs ((data->>'conversationId'));
create index if not exists supervision_logs_started_idx on interos.supervision_logs ((data->>'startedAt'));
