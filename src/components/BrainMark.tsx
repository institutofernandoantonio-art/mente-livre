import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Asset oficial do cérebro/elemento abstrato do Mente Livre. Recortado da
 * referência visual oficial em `docs/design-references/01-boas-vindas-capa.png`
 * (que permanece intacta como arquivo de referência — este é o recorte de
 * produção, só com o elemento gráfico, sem o mockup de tela/textos/botão).
 */
const BRAIN_ASSET_SRC = "/brand/mente-livre-brain.png";

interface BrainMarkProps {
  className?: string;
}

/**
 * Elemento visual principal da identidade do Mente Livre. Usa imagem
 * raster (não SVG) para ser fiel ao asset oficial da marca; o Next.js
 * otimiza formato/tamanho automaticamente via `next/image`.
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
