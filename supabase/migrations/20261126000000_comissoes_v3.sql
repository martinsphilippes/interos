-- =====================================================================================================================
-- INTEROS — Regras de comissão v3, planos comerciais e remuneração variável.
--
-- Coleções novas:
-- - commission_rule_versions: versão completa de cada regra de comissão (quem alterou, quando, motivo, o que mudou).
--   O motor aplica a versão vigente na data da venda; alterar uma regra não muda comissões de vendas anteriores, salvo
--   reaplicação autorizada.
-- - commercial_plans: planos comerciais por produto (ex.: ERP › Star), escolhidos em cada item da proposta e usados
--   pelas regras de comissão por plano.
-- - variable_pay_closings: fechamento mensal da remuneração variável por colaborador (comissões + bônus + prêmios),
--   congelado para conferência antes do pagamento.
-- Os campos novos de commission_rules, commissions e dos itens de proposta/contrato são opcionais (jsonb): aditiva, não
-- altera nem apaga dados.
-- =====================================================================================================================

select interos.create_doc_table('commission_rule_versions');
select interos.create_doc_table('commercial_plans');
select interos.create_doc_table('variable_pay_closings');
