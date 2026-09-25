/** Mensagem de erro de formulário (resultado de uma Server Action ou validação local). */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">
      {message}
    </p>
  );
}
