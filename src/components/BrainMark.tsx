import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Caminho do asset oficial do cérebro/elemento abstrato do Mente Livre.
 *
 * PROVISÓRIO: até hoje, este arquivo é um placeholder gerado (um blob azul
 * simples, sem tentar reproduzir a identidade oficial). Quando o arquivo
 * definitivo (PNG ou WebP, fundo transparente) for fornecido, basta
 * substituir o arquivo em `public/brand/mente-livre-brain.png` — ou, se o
 * formato/nome mudar, ajustar só a constante abaixo. Nenhuma outra parte da
 * tela precisa mudar.
 */
const BRAIN_ASSET_SRC = "/brand/mente-livre-brain.png";
export const BRAIN_ASSET_IS_PLACEHOLDER = true;

interface BrainMarkProps {
  className?: string;
}

/**
 * Elemento visual principal da identidade do Mente Livre. Usa imagem
 * raster (não SVG) para poder ser fiel ao asset oficial da marca; o
 * Next.js otimiza formato/tamanho automaticamente via `next/image`.
 */
export function BrainMark({ className }: BrainMarkProps) {
  return (
    <div className={cn("relative", className)}>
      <Image
        src={BRAIN_ASSET_SRC}
        alt="Símbolo do Mente Livre: uma mente sendo organizada"
        fill
        priority
        sizes="(min-width: 640px) 256px, 224px"
        className="object-contain"
      />
    </div>
  );
}
