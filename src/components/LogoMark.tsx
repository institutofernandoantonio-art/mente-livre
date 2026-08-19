/**
 * Símbolo pequeno da marca Mente Livre (aparece acima do wordmark e será
 * reaproveitado como ícone da IA em telas futuras). Aproximação vetorial do
 * traço "infinito/M" da referência visual oficial — não é um traçado
 * pixel-a-pixel, mas segue a mesma ideia de forma.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Símbolo do Mente Livre"
    >
      <defs>
        <linearGradient id="logoStroke" x1="4" y1="30" x2="44" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#60a5fa" />
        </linearGradient>
      </defs>
      <path
        d="M5 29c0-8 6-13 11-9.5c4 2.8 1.5 8.5-3.5 8.5c-6 0-6-9 2-14.5c7-5 18-3 22 6.5"
        stroke="url(#logoStroke)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="37" cy="10" r="2.6" fill="#3b82f6" />
    </svg>
  );
}
