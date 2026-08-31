import Link from "next/link";
import { BrainMark } from "@/components/BrainMark";
import { LogoMark } from "@/components/LogoMark";
import { buttonVariants } from "@/components/ui/Button";

export default function WelcomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 pt-16 pb-[max(2rem,env(safe-area-inset-bottom))] md:min-h-0 md:justify-center md:py-20">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <BrainMark className="h-48 w-56 sm:h-56 sm:w-64" />

        <LogoMark className="mt-6 h-8 w-10" />

        <h1 className="mt-4 text-2xl font-semibold tracking-[0.2em] uppercase">
          <span className="text-ink">Mente</span>{" "}
          <span className="text-brand-600">Livre</span>
        </h1>

        <div className="mt-4 h-px w-10 bg-mist-200" aria-hidden="true" />

        <p className="mt-4 text-base text-ink-soft">
          Sua mente pensa. A <span className="text-brand-600">IA</span> organiza.
        </p>
      </div>

      <div className="flex-1 md:hidden" aria-hidden="true" />

      <div className="w-full max-w-sm md:mt-10">
        <Link href="/conversa" className={buttonVariants("primary", "w-full")}>
          Começar
        </Link>
      </div>
    </main>
  );
}
