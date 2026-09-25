"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { getFirebaseAuth } from "@/lib/firebase/client";

/** Encerra a sessão no servidor (cookie) e no Firebase client. Não navega. */
export async function performLogout(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
  } catch (error) {
    console.warn("[auth] falha ao encerrar sessão no servidor", error);
  }
  try {
    await signOut(getFirebaseAuth());
  } catch {
    // Sem config do Firebase no cliente ou já deslogado: ignorar.
  }
}

export interface LogoutButtonProps extends Omit<ButtonProps, "onClick" | "loading"> {
  showIcon?: boolean;
}

export function LogoutButton({ children = "Sair", showIcon = true, variant = "ghost", ...props }: LogoutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    setLoading(true);
    await performLogout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <Button variant={variant} onClick={handleClick} loading={loading} {...props}>
      {showIcon && !loading ? <LogOut /> : null}
      {children}
    </Button>
  );
}
