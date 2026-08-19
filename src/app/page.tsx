import Link from "next/link";
import { BrainMark } from "@/components/BrainMark";
import { buttonVariants } from "@/components/ui/Button";

export default function WelcomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <BrainMark className="h-32 w-40" />

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-ink">
          Mente Livre
        </h1>
        <p className="mt-3 text-base text-ink-soft">
          Sua mente pensa. A IA organiza.
        </p>

        <Link href="/entrada" className={buttonVariants("primary", "mt-10 w-full")}>
          Começar
        </Link>
      </div>
    </main>
  );
}
