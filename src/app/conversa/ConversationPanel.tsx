'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { sendConversationMessage } from '@/lib/conversation/actions';
import { getConversationPresentationState } from '@/lib/conversation/presentation';
import type { ProposedAction } from '@/lib/conversation/proposed-action';
import {
  mapPresentationBootstrap,
  mapEntryResultToUiEffect,
  formatDeadlinePreview,
  formatDurationPreview,
  type UiMessageContent,
} from '@/lib/conversation/presentation-ui';

// ============================================================================
// Painel conversacional mínimo — o único Client Component desta rota.
//
// Transport boundary consumida: SOMENTE `sendConversationMessage(text)`
// (envio) e `getConversationPresentationState()` (bootstrap na montagem) —
// os dois únicos pontos públicos já aprovados nas subfases anteriores.
// Nenhum outro import de `src/lib/conversation/` além desses dois, do type
// `ProposedAction` (só para tipar o preview) e do helper puro
// `presentation-ui.ts` (mapeamento DTO→UI, sem lógica de domínio).
//
// Este componente NUNCA:
// - importa Supabase/`conversation-entry` internals/`runtime-state-storage`/
//   `conversation-turn`/`proposal-turn`/`intent-extraction`/`confirmation`/
//   `local-task-execution`/Anthropic/Calendar;
// - conhece `stateId`/`proposalId`/`userId`/`expiresAt`/`ConversationState`/
//   `ProposalState` — o único id que o DTO de envio chega a carregar
//   (`confirmed.itemId`) é deliberadamente descartado por
//   `mapEntryResultToUiEffect` (presentation-ui.ts), nunca lido aqui;
// - persiste o transcript — `useState<UiMessage[]>` é só memória da página;
//   nenhum `localStorage`/`sessionStorage`/cookie/IndexedDB/tabela nova;
// - reutiliza o fluxo antigo de brain dump (`createBrainDump`/
//   `organizeBrainDump`/`getCalendarPlanningContext`) — fluxo
//   deliberadamente independente.
//
// --- `id` visual --------------------------------------------------------
//
// Gerado só aqui (`crypto.randomUUID()`, com fallback), só para `key` do
// React — nunca enviado ao servidor, nunca relacionado a
// `stateId`/`proposalId`/`itemId` reais.
//
// --- Bootstrap sob Strict Mode: aceitar 2 leituras, nunca travar ----------
//
// `reactStrictMode` não está desligado em `next.config.ts` (fica no
// default do Next.js, que é `true`), então em desenvolvimento o efeito de
// montagem roda 2x (monta→limpa→monta de novo). Uma versão anterior deste
// componente usava um `useRef` para garantir NO MÁXIMO uma chamada real a
// `getConversationPresentationState()` — só que a combinação de um guard
// que SOBREVIVE às duas invocações com uma flag de cancelamento que só
// vale DENTRO de cada invocação tinha um efeito colateral real: a função
// de limpeza da primeira invocação marcava a ÚNICA promise em voo como
// cancelada (porque a segunda invocação, bloqueada pelo guard, nunca
// registrava uma nova flag "viva") — `setBootstrapping(false)` nunca
// rodava, e a UI ficava presa em "Carregando..." para sempre (bug
// reproduzido e documentado na subfase de teste manual correspondente).
//
// Correção: nenhum guard persistente entre invocações. Cada execução do
// efeito tem sua PRÓPRIA flag `active`, fechada só sobre aquela chamada —
// a função de limpeza de uma invocação nunca pode envenenar a promise de
// outra. Sob Strict Mode isso pode custar uma segunda leitura real em
// desenvolvimento (a primeira é descartada pelo cleanup, a segunda é a
// que efetivamente atualiza a UI) — aceitável porque
// `getConversationPresentationState()` é 100% read-only e idempotente
// (nunca muta runtime state, nunca dispara NLU/Confirmation/Execution).
// Em produção (sem Strict Mode) o efeito roda uma vez só, então há sempre
// exatamente 1 leitura real ali. Nenhum estado global, nenhuma promise
// compartilhada, nenhuma dependência nova.
// ============================================================================

type UiMessage = UiMessageContent & { id: string };

function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback só para ambientes sem `crypto.randomUUID` — ainda assim só
  // uma key de React, nunca um identificador que atravessa o servidor.
  return `msg-${Math.random().toString(36).slice(2)}`;
}

export function ConversationPanel() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const state = await getConversationPresentationState();
        if (!active) {
          return;
        }
        const content = mapPresentationBootstrap(state);
        if (content !== null) {
          setMessages((prev) => [...prev, { ...content, id: nextId() }]);
        }
      } catch {
        // Mesma disciplina do catch de submit: nunca loga detalhe, só
        // mostra uma mensagem genérica — só se esta execução ainda for a
        // ativa (ver `active` acima).
        if (!active) {
          return;
        }
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' },
        ]);
      } finally {
        // `bootstrapping` só é liberado pela execução que ainda é a
        // ativa — uma execução descartada pelo cleanup (Strict Mode)
        // nunca reabre a UI depois que a execução seguinte já terminou.
        if (active) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || bootstrapping) {
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // Proteção de UX mínima — nunca envia mensagem vazia/só espaço.
      // O dispatcher continua sendo a fonte real de validação de conteúdo.
      return;
    }

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', kind: 'text', text }]);
    setPending(true);

    try {
      const result = await sendConversationMessage(text);
      const { message, clearInput } = mapEntryResultToUiEffect(result);
      setMessages((prev) => [...prev, { ...message, id: nextId() }]);
      if (clearInput) {
        setText('');
      }
    } catch {
      // A Server Action já faz catch estreito internamente — isto cobre
      // só falha de transporte/framework na chamada em si. Nunca loga o
      // texto do usuário nem detalhe da exceção.
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' },
      ]);
    } finally {
      setPending(false);
    }
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
  }

  const inputDisabled = pending || bootstrapping;

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Conversa</h1>

      <div role="log" aria-live="polite" className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {bootstrapping && <p className="text-sm text-ink-soft">Carregando...</p>}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Textarea
          label="O que está ocupando sua mente?"
          maxLength={10000}
          value={text}
          onChange={handleTextChange}
          disabled={inputDisabled}
        />
        <Button type="submit" variant="primary" loading={pending} disabled={inputDisabled} className="w-full">
          Enviar
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'max-w-[85%] rounded-xl px-4 py-2 text-sm',
        isUser ? 'self-end bg-brand-600 text-white' : 'self-start bg-mist-50 text-ink',
      )}
    >
      {message.kind === 'text' && <p>{message.text}</p>}
      {message.kind === 'proposal' && <ProposalPreview action={message.action} />}
    </div>
  );
}

function ProposalPreview({ action }: { action: ProposedAction }) {
  const deadlineText = formatDeadlinePreview(action.task.deadline);
  const durationText = formatDurationPreview(action.task.duration);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">Tarefa: {action.task.title}</p>
      {action.task.description && <p className="text-ink-soft">{action.task.description}</p>}
      {deadlineText && <p className="text-ink-soft">Prazo: {deadlineText}</p>}
      {durationText && <p className="text-ink-soft">Duração: {durationText}</p>}
      <p className="mt-1 text-xs text-ink-soft">Responda &quot;sim&quot; ou &quot;não&quot; para confirmar.</p>
    </div>
  );
}
