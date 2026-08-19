import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonVariants } from "@/components/ui/Button";

/**
 * Placeholder da Tela 2 (despejo mental). O fluxo completo de texto/voz
 * é construído na Fase 3 — esta página só evita um link quebrado na Fase 1.
 */
export default function EntradaPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <EmptyState
          title="Essa tela chega na próxima fase"
          description="O despejo mental por texto e voz será construído na Fase 3 do projeto."
          action={
            <Link href="/" className={buttonVariants("secondary")}>
              Voltar ao início
            </Link>
          }
        />
      </div>
    </main>
  );
}
