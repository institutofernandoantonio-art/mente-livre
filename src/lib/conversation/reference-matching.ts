import type { EventReference } from './types';

// ============================================================================
// Reference Matching — "algum dos candidatos JÁ FORNECIDOS corresponde a
// essa referência textual?"
//
// Recebe uma lista de candidatos já buscada por uma camada de I/O externa
// (fora deste módulo) e decide, de forma pura e determinística, se
// exatamente um deles corresponde à referência. NUNCA busca dado sozinho,
// NUNCA autoriza uma ação, NUNCA escolhe entre candidatos ambíguos.
//
// Reference Matching é só a metade PURA da futura Reference Resolution
// (ver relatório de mapeamento da subfase anterior): reference fetching
// (buscar candidatos em `items`/Calendar) fica inteiramente fora deste
// arquivo, de propósito — mistura consulta externa e heurística de
// matching na mesma função tornaria a heurística impossível de testar
// deterministicamente.
//
// Alta precisão, não alto recall: qualquer dúvida de segurança prefere
// `not_found` a um palpite. Reconhecer uma referência (Conversation
// Understanding, fora daqui) nunca é o mesmo que resolvê-la contra dados
// reais — ver EventReference.resolvedId abaixo.
//
// Zero side effects, zero I/O, zero Date.now(), zero dependência de
// Next.js/Supabase/Anthropic/Google. Mesmo input, sempre mesmo output.
// Não loga nada — os títulos/candidatos recebidos nunca saem deste
// processo em memória.
// ============================================================================

// --- Candidato mínimo ---------------------------------------------------
//
// Contrato local a este módulo (não em types.ts): o matcher não precisa
// saber COMO um candidato foi obtido, só o mínimo para comparar e exibir.
// `source` existe para permitir, com segurança, recusar fontes ainda não
// suportadas (ver `unsupported` abaixo) sem precisar adivinhar
// comportamento para elas.
//
// Deliberadamente SEM: description, attendees, location, notes, tokens,
// userId, payload bruto do Calendar, objetos do Supabase — nenhum desses
// é necessário para decidir "qual candidato corresponde", e incluí-los
// aumentaria a superfície de dados sensíveis que passam por este módulo
// sem necessidade real.
export type ReferenceCandidate = {
  source: 'local_item' | 'google_calendar_event';
  id: string;
  title: string;
  // Carregado só porque um `item` local realmente tem categoria — não
  // usado por nenhuma regra de matching nesta versão (ver função
  // `matchByTitle` abaixo): mapear linguisticamente uma referência para
  // uma categoria ("reunião" → "compromisso") exigiria heurística nova,
  // não uma normalização segura, e não há base para isso ainda.
  category?: string;
};

// --- Resultado ------------------------------------------------------------
//
// `ambiguous.candidates` é uma tupla de PELO MENOS DOIS elementos — nunca
// um array solto: "ambíguo com 1 candidato" seria tão incoerente quanto
// os estados já corrigidos em ResolvedValue<T>/ClarificationDecision
// noutros módulos desta mesma pasta.
//
// Deliberadamente SEM `confirmed`/`authorized`/`executed`: nenhum status
// aqui autoriza ação alguma. Deliberadamente SEM `error`: falha de
// fetching (Calendar indisponível, token inválido) é responsabilidade da
// futura camada de I/O, nunca deste matcher puro — um matcher que só
// recebe candidatos já em memória não tem como distinguir "fonte vazia"
// de "fonte indisponível", então nunca deveria fingir que sabe.
export type ReferenceMatchResult =
  | { status: 'resolved'; candidate: ReferenceCandidate }
  | { status: 'ambiguous'; candidates: [ReferenceCandidate, ReferenceCandidate, ...ReferenceCandidate[]] }
  | { status: 'not_found' }
  | { status: 'unsupported' };

// --- Normalização conservadora ---------------------------------------------
//
// NFD + remoção de marcas diacríticas é normalização Unicode padrão do
// próprio JavaScript, não uma correção fonética/semântica — "joão" e
// "joao" são a mesma palavra escrita com/sem acento, nunca duas palavras
// diferentes "corrigidas" uma na outra. Nunca modifica o valor original:
// só usada aqui, dentro da função, para comparação — o `title`/`raw`
// devolvido ao chamador é sempre o valor original do candidato.
function normalizeForComparison(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// --- Matching por título -----------------------------------------------
//
// Só dois critérios, nessa ordem, cada um documentado e simples:
//
// 1. Match exato: título normalizado igual à referência normalizada.
//    Sempre tentado primeiro — é o critério mais seguro.
// 2. Contains controlado: só se NENHUM match exato existir. A referência
//    normalizada precisa ser uma substring CONTÍGUA do título
//    normalizado (nunca o inverso, nunca palavras soltas em qualquer
//    ordem) — "joão" dentro de "reunião com joão" é seguro; "reunião
//    joão" dentro de "reunião semanal com joão" NÃO bate (há texto no
//    meio quebrando a contiguidade) e cai em not_found, não em um
//    palpite por palavras-chave.
//
// Nenhum fuzzy matching, nenhuma distância de edição, nenhum stemming:
// "financeiro" nunca casa com "financeira" (sufixo diferente) mesmo
// sendo a mesma raiz linguística — inventar essa equivalência exigiria
// uma heurística nova, não uma normalização segura.
function matchByTitle(
  normalizedReference: string,
  candidates: readonly ReferenceCandidate[],
): ReferenceCandidate[] {
  const exactMatches = candidates.filter(
    (candidate) => normalizeForComparison(candidate.title) === normalizedReference,
  );
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return candidates.filter((candidate) =>
    normalizeForComparison(candidate.title).includes(normalizedReference),
  );
}

function toAmbiguousResult(matches: ReferenceCandidate[]): ReferenceMatchResult {
  // Seguro: só chamado depois de confirmar matches.length >= 2 no
  // call-site — mesmo padrão de cast pós-checagem já usado em
  // clarification.ts para ClarificationDecision.missingFields.
  return {
    status: 'ambiguous',
    candidates: matches as [ReferenceCandidate, ReferenceCandidate, ...ReferenceCandidate[]],
  };
}

// --- API principal -----------------------------------------------------
//
// `reference.kind` só tem hoje o literal `'existing_reference'` no
// contrato real (types.ts) — não existe outro `kind` para EventReference
// ainda, então não há nenhuma checagem de runtime a fazer aqui para
// "suportar só existing_reference": o próprio tipo já garante isso. Se o
// contrato crescer no futuro para incluir outros kinds, este comentário
// (e uma checagem real) precisará ser revisto então — não implementado
// preventivamente sem um caso real.
//
// `reference.resolvedId`: NUNCA tratado como autoridade. Este matcher não
// tem como validar ownership, existência real ou a que fonte um id
// pré-existente pertence — revalidar isso é responsabilidade exclusiva de
// uma futura Reference Resolution server-side. Para evitar a semântica
// enganosa de "escolher um candidato" quando a referência já alega estar
// resolvida (o que poderia produzir um resultado divergente e confuso do
// resolvedId já presente), uma referência com `resolvedId !== null`
// retorna `unsupported` — este matcher simplesmente não opera sobre esse
// caso nesta primeira versão.
//
// Candidatos com `source !== 'local_item'` (ex.: `google_calendar_event`)
// tornam a chamada INTEIRA `unsupported`, nunca são silenciosamente
// ignorados: ignorá-los poderia produzir um `not_found` falso — o
// candidato certo poderia estar exatamente entre os ignorados. É mais
// seguro recusar a operação inteira do que arriscar um "não encontrei"
// que não é verdade. Matching real de Google Calendar fica para uma
// subfase futura, com sua própria análise de segurança.
export function matchEventReference(
  reference: EventReference,
  candidates: readonly ReferenceCandidate[],
): ReferenceMatchResult {
  if (reference.resolvedId !== null) {
    return { status: 'unsupported' };
  }

  const normalizedReference = normalizeForComparison(reference.raw);
  if (normalizedReference === '') {
    // Vazio/só espaços não é "uma busca real que não achou nada" — é
    // ausência de critério de busca. Tratado como unsupported, não
    // not_found, para nunca confundir os dois significados (ver
    // relatório: not_found deve significar sempre "busca real, zero
    // resultado"). Também evita o perigo real de `"".includes("")` casar
    // com QUALQUER candidato no matching por contains abaixo.
    return { status: 'unsupported' };
  }

  if (candidates.some((candidate) => candidate.source !== 'local_item')) {
    return { status: 'unsupported' };
  }

  if (candidates.length === 0) {
    return { status: 'not_found' };
  }

  const matches = matchByTitle(normalizedReference, candidates);

  if (matches.length === 0) {
    return { status: 'not_found' };
  }
  if (matches.length === 1) {
    return { status: 'resolved', candidate: matches[0] };
  }
  return toAmbiguousResult(matches);
}
