export type TaskPriorityBucket = 'fazer_hoje' | 'planejar' | 'delegar' | 'depois';
export type TaskPriorityValue = 'alta' | 'média' | 'baixa' | null;

export type TaskPriorityCommand = {
  referenceRaw: string;
  priority: TaskPriorityValue;
  bucket: TaskPriorityBucket;
};

const CLASSIFICATIONS: Array<{
  expressions: string[];
  priority: TaskPriorityValue;
  bucket: TaskPriorityBucket;
}> = [
  {
    expressions: ['urgente e importante', 'fazer hoje'],
    priority: 'alta',
    bucket: 'fazer_hoje',
  },
  {
    expressions: ['importante mas não urgente', 'importante mas nao urgente', 'planejar'],
    priority: 'média',
    bucket: 'planejar',
  },
  {
    expressions: ['urgente mas menos importante', 'delegar'],
    priority: 'baixa',
    bucket: 'delegar',
  },
  {
    expressions: ['sem urgência agora', 'sem urgencia agora', 'depois'],
    priority: null,
    bucket: 'depois',
  },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:a|o)\s+tarefa\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim();
}

export function parseTaskPriorityCommand(text: string): TaskPriorityCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  for (const classification of CLASSIFICATIONS) {
    for (const expression of classification.expressions) {
      const escaped = escapeRegExp(expression);
      const patterns = [
        new RegExp(`^(?:marque|classifique|coloque)\\s+(.+?)\\s+como\\s+${escaped}[.!?]*$`, 'iu'),
        new RegExp(`^(.+?)\\s+(?:é|e)\\s+${escaped}[.!?]*$`, 'iu'),
      ];

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        const referenceRaw = cleanReference(match[1]);
        if (referenceRaw.length === 0) return null;
        return {
          referenceRaw,
          priority: classification.priority,
          bucket: classification.bucket,
        };
      }
    }
  }

  return null;
}
