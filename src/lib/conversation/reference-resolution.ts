import 'server-only';

import { createClient } from '../supabase/server';
import { matchEventReference, type ReferenceCandidate, type ReferenceMatchResult } from './reference-matching';
import type { EventReference } from './types';

// ============================================================================
// Reference Resolution (local_item) — "busca os candidatos DESTE usuário e
// deixa o matcher puro decidir."
//
// Fronteira server-only: descobre QUEM é o usuário (sessão atual, nunca um
// argumento), busca SOMENTE os `items` desse usuário, reduz cada linha ao
// mínimo necessário, e delega toda a decisão (exato/contains/ambíguo/zero)
// para matchEventReference() — já validado, puro, determinístico. Esta
// função BUSCA; reference-matching.ts DECIDE. Nenhuma normalização, exact
// match, contains ou lógica de ambiguidade é duplicada aqui.
//
// Função interna server-side, não uma Server Action pública: não há hoje
// nenhum Client Component que precise chamá-la diretamente (ver relatório
// de mapeamento da subfase anterior) — `server-only` já basta para
// impedir que este módulo vaze para o bundle do cliente por engano.
//
// Não conecta com UI, ConversationState, Clarification Policy ou
// StructuredIntent — recebe uma EventReference já decidida como pendente
// por camadas anteriores, resolve, e devolve só o resultado. Atualizar o
// intent com o resultado é responsabilidade de um futuro orquestrador,
// não desta função.
// ============================================================================

// Só acrescenta `error` (falha técnica) ao vocabulário puro de
// ReferenceMatchResult — nunca `confirmed`/`authorized`/`executed`/
// `retryable`/mensagens de erro cruas. `error` nunca deve ser confundido
// com `not_found`: falha de auth/banco significa "não sei se existe",
// nunca "sei que não existe" — ver função abaixo.
export type LocalReferenceResolutionResult = ReferenceMatchResult | { status: 'error' };

// Recebe SÓ a referência — nunca userId (deriva sempre da sessão atual via
// getClaims), nunca uma lista de candidatos (o servidor busca os seus
// próprios), nunca `source` (sempre atribuído aqui dentro, nunca vindo de
// fora). O cliente nunca é uma fonte confiável para nenhum desses dados.
export async function resolveEventReferenceFromLocalItems(
  reference: EventReference,
): Promise<LocalReferenceResolutionResult> {
  // Invariante obrigatória desta subfase, checada ANTES de qualquer I/O:
  // EventReference ainda não carrega `source`, então um resolvedId
  // pré-existente pode pertencer a local_item, a uma futura referência de
  // Google Calendar, ou a qualquer outra fonte futura — este módulo não
  // tem como saber com segurança qual, e por isso nunca tenta revalidar.
  // matchEventReference() já aplicaria essa mesma regra mais adiante, mas
  // checá-la aqui primeiro evita uma consulta ao banco totalmente inútil
  // para um caso cujo resultado já é conhecido de antemão. Quando uma
  // segunda fonte real for integrada, este contrato precisará evoluir
  // para um identificador discriminado por source — não implementado
  // agora.
  if (reference.resolvedId !== null) {
    return { status: 'unsupported' };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  // Sem sessão válida é uma falha técnica de autenticação, não uma busca
  // que deu zero resultado — nunca `not_found` aqui. Mesmo padrão de
  // distinção já usado no relatório de mapeamento (error vs not_found).
  if (!userId) {
    return { status: 'error' };
  }

  // Query mínima: só id/title/category, nunca description/brain_dump_id/
  // priority/needs_confirmation/created_at, e nunca user_id no payload
  // devolvido adiante (usado só como filtro abaixo). Defesa em
  // profundidade: RLS (items_select_own, `auth.uid() = user_id`) já
  // impede ler linha de outro usuário, e o `.eq('user_id', userId)`
  // explícito é reforço, não a única barreira — mesmo padrão já usado em
  // planning-context.ts para esta mesma tabela. Cliente cookie-based
  // normal, nunca admin/service_role: `items` já concede SELECT own a
  // `authenticated` via RLS, então usar a chave secreta aqui só abriria
  // mão dessa barreira sem necessidade real. Sem `.limit()`: truncar
  // candidatos poderia produzir um `not_found`/`resolved` falso se o
  // candidato certo ficasse de fora — aceito conscientemente para o
  // volume atual do produto (ver relatório: escalabilidade futura).
  // Sem `.order()`: o matcher nunca usa ordem para decidir, então nenhuma
  // ordenação é necessária aqui.
  const { data: rows, error } = await supabase
    .from('items')
    .select('id, title, category')
    .eq('user_id', userId);

  // Erro de query é falha técnica — nunca not_found. Nenhum detalhe do
  // erro (message/details/hint/code) é lido, retornado ou logado.
  if (error) {
    return { status: 'error' };
  }

  // `category`/`title` são `not null` no schema real (ver migration de
  // items) — nenhuma validação de runtime adicional é inventada aqui além
  // do que o próprio banco já garante, mesmo padrão já usado no resto do
  // projeto (ex.: organizeBrainDump confia em brainDump.raw_text sem
  // revalidar). `source: 'local_item'` é sempre um literal atribuído por
  // este código, nunca lido de `row` — a linha do banco não tem (nem
  // deveria ter) um campo `source`.
  const candidates: ReferenceCandidate[] = (rows ?? []).map((row) => ({
    source: 'local_item',
    id: row.id,
    title: row.title,
    category: row.category,
  }));

  // Referência vazia (raw === '' após normalização) não é short-circuited
  // aqui antes da busca: matchEventReference() já decide isso com
  // segurança (retorna 'unsupported', nunca 'not_found'), e duplicar essa
  // checagem aqui criaria uma segunda fonte de verdade para uma regra que
  // já pertence só ao matcher. O custo é, no pior caso, uma consulta a
  // `items` que será descartada pelo matcher — aceitável em nome de
  // manter uma única fonte de verdade para essa regra específica
  // (diferente do resolvedId acima, que é checado cedo por representar um
  // caso mais comum e cujo I/O evitado é sempre inútil, nunca só "às vezes").
  return matchEventReference(reference, candidates);
}
