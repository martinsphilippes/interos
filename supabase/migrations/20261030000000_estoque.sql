-- =====================================================================================================================
-- INTEROS — Estoque de equipamentos (fase 2 do circuito hardware: faturamento → estoque → compras → entrega).
--
-- Coleções novas:
-- - stock_items: item de estoque (fabricante, modelo, série obrigatória ou não, origem, mínimo, produtos que o usam)
--   com o saldo em mãos, o reservado e o custo médio.
-- - stock_movements: histórico de cada movimentação (entrada com custo, reserva, liberação, saída, devolução e ajuste
--   com motivo) com o saldo depois dela — a trilha de auditoria do estoque.
-- - stock_serials: número de série de cada unidade e onde ela está (estoque, cliente, baixada).
-- - stock_reservations: reserva de um item para um contrato (pedida, separada, entregue, devolvida).
-- A configuração fica em settings (key "estoque"). Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('stock_items');
select interos.create_doc_table('stock_movements');
select interos.create_doc_table('stock_serials');
select interos.create_doc_table('stock_reservations');
