/**
 * Esquemas (zod) do cadastro de planos comerciais. Sem dependências de servidor: importado pelas Server Actions e pelo
 * formulário (mesmas mensagens).
 */
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`).optional().or(z.literal("").transform(() => undefined));
const price = (label: string) => z.number(`${label} inválido`).min(0, `${label} não pode ser negativo`).max(10_000_000, `${label} muito alto`).nullable().optional();

export const planSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z
    .string()
    .trim()
    .min(2, "Informe o código do plano (mín. 2 caracteres)")
    .max(30, "Código muito longo (máx. 30)")
    .regex(/^[A-Za-z0-9._-]+$/, "Código: use letras, números, ponto, hífen ou sublinhado")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, "Informe o nome do plano").max(80, "Nome muito longo"),
  productId: optionalText(60),
  description: optionalText(500),
  setupPrice: price("Preço de adesão"),
  monthlyPrice: price("Preço da mensalidade"),
  active: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof planSchema>;
export type PlanFormInput = z.input<typeof planSchema>;

export const planActiveSchema = z.object({ id: z.string().trim().min(1, "Plano inválido"), active: z.boolean() });
