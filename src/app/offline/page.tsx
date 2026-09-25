import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sem conexão" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-md">
        <CardContent>
          <EmptyState
            icon={<WifiOff />}
            title="Você está offline"
            description="Não foi possível conectar ao INTEROS. Verifique sua conexão e tente novamente."
            action={
              <Button asChild>
                <Link href="/meu-dia">Tentar novamente</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </main>
  );
}
