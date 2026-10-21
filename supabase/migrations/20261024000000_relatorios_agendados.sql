-- =====================================================================================================================
-- INTEROS — Central de Atendimento, fase 4: envio agendado de relatórios.
--
-- Coleção nova: report_schedules (quem agendou, para quem, qual relatório, período, formato e próxima execução).
-- Índice para o agendador achar os envios vencidos. Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('report_schedules');

create index if not exists report_schedules_next_run_idx on interos.report_schedules ((data->>'nextRunAt'));
