-- =====================================================================================================================
-- INTEROS — agendador da Central de Atendimento (pg_cron + pg_net do Supabase).
--
-- Por que existe: o plano atual da Vercel só roda tarefas agendadas uma vez por dia. A Central precisa de uma
-- verificação a cada 5 minutos (transbordo de fila, aviso de posição, lembrete e encerramento por falta de resposta,
-- menu sem resposta, limpeza dos registros técnicos e sincronização dos modelos do WhatsApp). O Supabase chama a rota
-- /api/cron/central do INTEROS a cada 5 minutos.
--
-- NÃO é migration (fica fora de supabase/migrations): depende do domínio de produção e de um segredo. Rodar UMA vez
-- no SQL Editor do Supabase, nesta ordem:
--
--   1. Guardar o segredo no Vault — o MESMO valor da variável CRON_SECRET da Vercel (Settings → Environment Variables).
--      O valor nunca entra no repositório:
--        select vault.create_secret('<valor do CRON_SECRET>', 'interos_cron_secret');
--
--   2. Rodar o restante deste arquivo trocando <DOMINIO> pelo domínio de produção do INTEROS.
--
-- Para desligar: select cron.unschedule('interos-central');
-- Para ver as últimas execuções: select * from cron.job_run_details where jobid = (select jobid from cron.job
--   where jobname = 'interos-central') order by start_time desc limit 20;
-- =====================================================================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('interos-central') where exists (select 1 from cron.job where jobname = 'interos-central');

select cron.schedule(
  'interos-central',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://<DOMINIO>/api/cron/central',
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'interos_cron_secret'),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $$
);
