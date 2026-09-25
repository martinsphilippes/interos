"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "./form-error";

export interface SettingsSectionProps {
  title: string;
  description?: React.ReactNode;
  /** Documento já existe no banco (senão mostra "padrão"). */
  stored: boolean;
  pending: boolean;
  error?: string | null;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
  submitLabel?: string;
  /** Sem rodapé de salvar (seções que salvam por linha, como SLA). */
  hideFooter?: boolean;
}

/** Card padrão de uma seção de configurações: título, badge de origem, formulário e botão salvar. */
export function SettingsSection({ title, description, stored, pending, error, onSubmit, children, submitLabel = "Salvar", hideFooter }: SettingsSectionProps) {
  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <Badge variant={stored ? "success" : "muted"} size="sm" className="shrink-0">
            {stored ? "Gravado" : "Padrão (não gravado)"}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {children}
          <FormError message={error} />
        </CardContent>
        {!hideFooter ? (
          <CardFooter className="justify-end">
            <Button type="submit" loading={pending}>
              {submitLabel}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}
