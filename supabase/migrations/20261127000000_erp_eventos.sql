-- =====================================================================================================================
-- INTEROS — Eventos do ERP Intercert para o INTEROS (webhook POST /api/webhooks/erp, assinado com X-ERP-Signature).
--
-- Coleção nova:
-- - erp_events: cada evento recebido do ERP (licença aplicada ou recusada, mudança automática de módulos, pedido de
--   módulo, limite do contrato atingido), com id = ambiente + hash do eventId do ERP. Garante que a mesma entrega (o
--   ERP repete até receber 200) seja processada uma vez só, e guarda a situação e o resultado para a administração.
--   O aviso diário "ERP sem licença nova" fica em UM registro por empresa (id = ambiente + "stale" + empresa).
-- Aditiva: não altera nem apaga dados. Como as demais coleções, só o papel interos_app tem acesso (nada exposto a
-- anon/authenticated).
-- =====================================================================================================================

select interos.create_doc_table('erp_events');
