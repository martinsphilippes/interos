/**
 * Classes de erro de autorização e de regra de negócio (A5), sem dependências do Next: podem ser importadas por
 * serviços usados fora de requisição (seed, scripts, handlers). `errors.ts` as reexporta junto com `failAction`.
 */
/** Mensagem padrão de acesso negado (sem revelar o que existe do outro lado). */
export const ACCESS_DENIED_MESSAGE = "Acesso negado: seu perfil não tem permissão para esta operação.";

/** Negação de permissão em Server Action (requirePermission). A mensagem é segura para o usuário. */
export class PermissionError extends Error {
  readonly key?: string;
  constructor(message: string = ACCESS_DENIED_MESSAGE, key?: string) {
    super(message);
    this.name = "PermissionError";
    this.key = key;
  }
}

/** Sem sessão válida numa Server Action ou API. */
export class AuthenticationError extends Error {
  constructor(message = "Sua sessão expirou. Entre novamente.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Erro de regra de negócio com mensagem escrita para o usuário: failAction sempre a exibe. Use nos serviços quando a
 * mensagem precisa chegar à interface mesmo contendo termos que pareceriam técnicos.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}
