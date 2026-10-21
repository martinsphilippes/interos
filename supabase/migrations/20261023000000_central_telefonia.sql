-- =====================================================================================================================
-- INTEROS — Central de Atendimento, fase 3 (telefonia).
--
-- As ligações continuam em `communications` (canal "voip", id call_<hash do CallSid>). Coleção nova:
-- - recording_access_logs: quem ouviu ou baixou cada gravação, quando e por quê (política de gravação).
-- Índices para o histórico de ligações e a busca da ligação pelo CallSid. Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('recording_access_logs');

create index if not exists recording_access_logs_communication_idx on interos.recording_access_logs ((data->>'communicationId'));
create index if not exists communications_channel_idx on interos.communications ((data->>'channel'));
