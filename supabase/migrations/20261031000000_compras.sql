-- =====================================================================================================================
-- INTEROS — Compras (fase 3 do circuito hardware: faturamento → estoque → compras → entrega).
--
-- Coleções novas:
-- - purchase_orders: pedido de compra (PC-AAAA-NNNN) com fornecedor, linhas (item de estoque, quantidade, custo,
--   recebido), aprovação (opcional, acima de um valor configurável) e histórico.
-- - purchase_receipts: recebimento de um pedido: linhas recebidas (com números de série), NF do fornecedor, a entrada
--   no estoque de cada linha e o título gerado em Contas a Pagar.
-- A configuração fica em settings (key "compras"). Aditiva: não altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('purchase_orders');
select interos.create_doc_table('purchase_receipts');
