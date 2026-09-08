import type { UiMessageContent } from './presentation-ui';

export function buildSpokenResponse(message: UiMessageContent): string {
  if (message.role !== 'assistant') return '';

  if (message.kind === 'text') {
    return message.text.trim();
  }

  if (message.kind === 'proposal') {
    if (message.action.actionType === 'create_calendar_event') {
      return `Preparei o compromisso ${message.action.event.title}. Confira os detalhes e responda sim ou não para confirmar.`;
    }

    return `Preparei a tarefa ${message.action.task.title}. Confira os detalhes e responda sim ou não para confirmar.`;
  }

  const options = message.suggestions.map((suggestion) => suggestion.label).join(' ou ');
  if (!options) return 'Esse horário não está disponível.';
  return `Esse horário não está disponível. Encontrei ${options}. Você pode escolher uma opção ou dizer outro horário.`;
}
