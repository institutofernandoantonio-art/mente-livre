'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { sendConversationMessage } from '@/lib/conversation/actions';
import { getConversationPresentationState } from '@/lib/conversation/presentation';
import type { ProposedAction } from '@/lib/conversation/proposed-action';
import { VoiceDictationButton } from './VoiceDictationButton';
import { resolveScheduleTask } from './schedule-task-action';
import {
  mapPresentationBootstrap,
  mapEntryResultToUiEffect,
  formatDeadlinePreview,
  formatDurationPreview,
  buildEventProposalPreview,
  type UiMessageContent,
} from '@/lib/conversation/presentation-ui';

type UiMessage = UiMessageContent & { id: string };
type ScheduleSuggestionDay = 'today' | 'tomorrow';

function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Math.random().toString(36).slice(2)}`;
}

export function ConversationPanel() {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [scheduleTaskTitle, setScheduleTaskTitle] = useState('');
  const [scheduleDefaultDay, setScheduleDefaultDay] = useState<ScheduleSuggestionDay>('today');
  const [logElement, setLogElement] = useState<HTMLDivElement | null>(null);
  const [latestAssistantElement, setLatestAssistantElement] = useState<HTMLDivElement | null>(null);

  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id ?? null;

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const state = await getConversationPresentationState();
        if (!active) return;
        const content = mapPresentationBootstrap(state);
        if (content !== null) {
          setMessages((prev) => [...prev, { ...content, id: nextId() }]);
        }

        const taskId = new URLSearchParams(window.location.search).get('agendarTask')?.trim() ?? '';
        if (taskId) {
          const task = await resolveScheduleTask(taskId);
          if (!active) return;
          setScheduleTaskTitle(task.status === 'ok' ? task.title : '');
          setScheduleDefaultDay('today');
        }
      } catch {
        if (!active) return;
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' },
        ]);
      } finally {
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

  useEffect(() => {
    if (latestAssistantId === null || latestAssistantElement === null) return;

    const frame = window.requestAnimationFrame(() => {
      if (logElement) {
        logElement.scrollTo({ top: logElement.scrollHeight, behavior: 'smooth' });
      }
      latestAssistantElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [latestAssistantId, latestAssistantElement, logElement]);

  async function submitText(text: string) {
    if (pending || bootstrapping) return;

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const alreadyExplicit = /^(agende|marque|remarque|mude|cancele)\b/iu.test(trimmed);
    const isConfirmation = /^(sim|n[aã]o)$/iu.test(trimmed);
    const startsWithDay = /^(hoje|amanh[aã])\b/iu.test(trimmed);
    const defaultDayLabel = scheduleDefaultDay === 'tomorrow' ? 'amanhã' : 'hoje';
    const backendText = scheduleTaskTitle && !alreadyExplicit && !isConfirmation
      ? startsWithDay
        ? `Agende ${scheduleTaskTitle} ${trimmed}`
        : `Agende ${scheduleTaskTitle} ${defaultDayLabel} às ${trimmed}`
      : trimmed;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', kind: 'text', text }]);
    setPending(true);

    try {
      let result: Awaited<ReturnType<typeof sendConversationMessage>>;
      if (scheduleTaskTitle) {
        result = await sendConversationMessage(
          backendText,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
      } else {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        result = await sendConversationMessage(text, timezone);
      }

      if (result.status === 'focus_ready') {
        const taskId = encodeURIComponent(result.taskId);
        router.push(`/hoje?focusTask=${taskId}&focusMinutes=${result.minutes}`);
        return;
      }

      if (result.status === 'schedule_conflict_suggestions') {
        setScheduleTaskTitle(result.taskTitle);
        const firstDay = result.suggestions[0]?.day;
        const allSameDay = firstDay !== undefined && result.suggestions.every((suggestion) => suggestion.day === firstDay);
        if (allSameDay) setScheduleDefaultDay(firstDay);
      }

      const { message, clearInput } = mapEntryResultToUiEffect(result);
      setMessages((prev) => [...prev, { ...message, id: nextId() }]);
      if (clearInput || isConfirmation) {
        setText('');
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' },
      ]);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitText(text);
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
  }

  function handleVoiceTranscript(transcript: string) {
    setText(transcript.slice(0, 10000));
  }

  function offersYesNoQuickReply(message: UiMessage): boolean {
    if (message.role !== 'assistant') return false;
    if (message.kind === 'proposal') return true;
    if (message.kind !== 'text') return false;
    return /responda\s+[“"]sim[”"]\s+ou\s+[“"]n[aã]o[”"]/i.test(message.text);
  }

  const inputDisabled = pending || bootstrapping;

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Conversa</h1>

      {scheduleTaskTitle && (
        <div className="rounded-xl border border-brand-200 bg-mist-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Agendar horário</p>
          <p className="mt-1 font-medium text-ink">{scheduleTaskTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">Diga o horário. Ex.: “15 horas” ou “amanhã às 9”.</p>
        </div>
      )}

      <div
        ref={setLogElement}
        role="log"
        aria-live="polite"
        className="flex max-h-96 scroll-smooth flex-col gap-3 overflow-y-auto"
      >
        {bootstrapping && <p className="text-sm text-ink-soft">Carregando...</p>}
        {messages.map((message) => {
          const isLatestAssistant = message.role === 'assistant' && message.id === latestAssistantId;
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isLatestAssistant={isLatestAssistant}
              anchorRef={isLatestAssistant ? setLatestAssistantElement : undefined}
              showQuickConfirmation={isLatestAssistant && offersYesNoQuickReply(message)}
              quickReplyDisabled={inputDisabled}
              onQuickReply={(answer) => void submitText(answer)}
              onScheduleSuggestion={(day, hour) => {
                const dayLabel = day === 'tomorrow' ? 'amanhã' : 'hoje';
                void submitText(`Agende ${scheduleTaskTitle} ${dayLabel} às ${hour} horas`);
              }}
            />
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Textarea
          label={scheduleTaskTitle ? 'Que horário?' : 'O que está ocupando sua mente?'}
          maxLength={10000}
          value={text}
          onChange={handleTextChange}
          disabled={inputDisabled}
        />
        <VoiceDictationButton disabled={inputDisabled} onTranscript={handleVoiceTranscript} />
        <Button type="submit" variant="primary" loading={pending} disabled={inputDisabled} className="w-full">
          Enviar
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  isLatestAssistant = false,
  anchorRef,
  showQuickConfirmation = false,
  quickReplyDisabled = false,
  onQuickReply,
  onScheduleSuggestion,
}: {
  message: UiMessage;
  isLatestAssistant?: boolean;
  anchorRef?: (node: HTMLDivElement | null) => void;
  showQuickConfirmation?: boolean;
  quickReplyDisabled?: boolean;
  onQuickReply?: (answer: 'sim' | 'não') => void;
  onScheduleSuggestion?: (day: ScheduleSuggestionDay, hour: number) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div
      ref={anchorRef}
      className={cn(
        'max-w-[85%] rounded-xl px-4 py-2 text-sm',
        isUser ? 'self-end bg-brand-600 text-white' : 'self-start bg-mist-50 text-ink',
        isLatestAssistant && 'border-2 border-brand-600 shadow-sm',
      )}
    >
      {isLatestAssistant && <p className="mb-1 text-xs font-semibold text-brand-600">Mente Livre</p>}
      {message.kind === 'text' && <p>{message.text}</p>}
      {message.kind === 'proposal' && <ProposalPreview action={message.action} />}
      {message.kind === 'schedule_suggestions' && (
        <div>
          <p>Esse horário não está disponível. Encontrei estas alternativas:</p>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Horários livres">
            {message.suggestions.map((suggestion) => (
              <Button
                key={`${suggestion.day}-${suggestion.hour}`}
                type="button"
                variant="secondary"
                disabled={quickReplyDisabled}
                onClick={() => onScheduleSuggestion?.(suggestion.day, suggestion.hour)}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Toque em uma opção ou diga o dia e horário por voz.</p>
        </div>
      )}
      {showQuickConfirmation && onQuickReply && (
        <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Resposta rápida">
          <Button type="button" variant="primary" disabled={quickReplyDisabled} onClick={() => onQuickReply('sim')}>
            Sim
          </Button>
          <Button type="button" variant="secondary" disabled={quickReplyDisabled} onClick={() => onQuickReply('não')}>
            Não
          </Button>
        </div>
      )}
    </div>
  );
}

function ProposalPreview({ action }: { action: ProposedAction }) {
  if (action.actionType === 'create_calendar_event') {
    const preview = buildEventProposalPreview(action.event);

    return (
      <div className="flex flex-col gap-1">
        <p className="font-medium">Compromisso: {preview.title}</p>
        {preview.description && <p className="text-ink-soft">{preview.description}</p>}
        {preview.dateSpan === 'same_day' ? (
          <>
            <p className="text-ink-soft">Data: {preview.date}</p>
            <p className="text-ink-soft">Horário: {preview.timeRange}</p>
          </>
        ) : (
          <>
            <p className="text-ink-soft">Início: {preview.startText}</p>
            <p className="text-ink-soft">Fim: {preview.endText}</p>
          </>
        )}
        <p className="text-ink-soft">Aviso: {preview.reminderMinutes} minutos antes</p>
        <p className="mt-1 text-xs text-ink-soft">Responda &quot;sim&quot; ou &quot;não&quot; para confirmar.</p>
      </div>
    );
  }

  if (action.actionType !== 'create_local_task') return null;

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
