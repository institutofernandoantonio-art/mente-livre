/**
 * Símbolo abstrato do Mente Livre: um contorno de mente que se dissolve em
 * partículas. É um SVG (vetor), não uma imagem — fica leve em qualquer tela
 * (item 33 do briefing) e nunca deve parecer uma ilustração médica.
 */
export function BrainMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Símbolo do Mente Livre"
    >
      <defs>
        <linearGradient id="brainStroke" x1="20" y1="10" x2="180" y2="150" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>

      <path
        d="M70 20c-22 0-38 16-38 34 0 8 3 15 8 21-7 6-11 14-11 23 0 18 16 32 36 32h40c20 0 36-14 36-32 0-9-4-17-11-23 5-6 8-13 8-21 0-18-16-34-38-34-6 0-12 1-17 4-4-3-8-4-13-4z"
        stroke="url(#brainStroke)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M100 24v106M76 40c8 6 8 18 0 26M124 40c-8 6-8 18 0 26M62 78c10 2 16 10 16 20"
        stroke="url(#brainStroke)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />

      <circle cx="150" cy="46" r="2.5" fill="#60a5fa" opacity="0.8" />
      <circle cx="162" cy="64" r="1.8" fill="#93c5fd" opacity="0.7" />
      <circle cx="168" cy="86" r="2.2" fill="#3b82f6" opacity="0.6" />
      <circle cx="158" cy="106" r="1.5" fill="#93c5fd" opacity="0.5" />
      <circle cx="140" cy="120" r="1.8" fill="#60a5fa" opacity="0.4" />
      <circle cx="30" cy="58" r="1.8" fill="#93c5fd" opacity="0.6" />
      <circle cx="20" cy="80" r="1.5" fill="#60a5fa" opacity="0.5" />
    </svg>
  );
}
