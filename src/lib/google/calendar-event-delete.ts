'use server';
import 'server-only';

import {
  getGoogleCalendarAccessToken,
  hasGoogleCalendarEventWriteAuthorization,
} from './calendar';

export type DeleteGoogleCalendarEventResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'authorization_required' }
  | { status: 'error' };

// Primitiva mínima de DELETE para um evento JÁ resolvido por uma camada
// server-side. Não resolve linguagem natural, não escolhe candidato, não
// persiste proposta e não interpreta confirmação. A única responsabilidade
// aqui é executar a exclusão no calendário primário quando a autorização de
// escrita já está explicitamente habilitada para a conexão atual.
//
// O googleEventId é um identificador técnico e nunca deve atravessar a
// fronteira para o browser. Este módulo o aceita somente como argumento de
// código server-side e nunca o devolve em nenhum status.
export async function deleteGoogleCalendarEventById(
  googleEventId: string,
): Promise<DeleteGoogleCalendarEventResult> {
  if (!isSafeGoogleEventId(googleEventId)) {
    return { status: 'error' };
  }

  // Gate de menor privilégio ANTES de obter token e ANTES de qualquer
  // mutação externa. Conexão antiga/sem consentimento de escrita nunca chega
  // ao DELETE.
  const authorization = await hasGoogleCalendarEventWriteAuthorization();
  if (authorization === 'unauthorized') {
    return { status: 'authorization_required' };
  }
  if (authorization === 'error') {
    return { status: 'error' };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return { status: 'authorization_required' };
  }

  const encodedEventId = encodeURIComponent(googleEventId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedEventId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    return { status: 'error' };
  }

  if (response.status === 200 || response.status === 204) {
    return { status: 'deleted' };
  }
  if (response.status === 404 || response.status === 410) {
    // O compromisso já não existe mais. Não fingimos que o DELETE desta
    // tentativa aconteceu, mas também não tentamos recriar/rebuscar nada.
    return { status: 'not_found' };
  }
  if (response.status === 401) {
    return { status: 'authorization_required' };
  }

  // 403 pode ser quota, política operacional ou permissão específica; não
  // é seguro tratá-lo automaticamente como "reconecte a conta". Demais
  // respostas não-ok também permanecem erro genérico, sem corpo bruto.
  return { status: 'error' };
}

function isSafeGoogleEventId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1024 &&
    !/[\s/\\?#]/.test(value)
  );
}
