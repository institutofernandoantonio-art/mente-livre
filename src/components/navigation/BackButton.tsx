'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type BackButtonProps = {
  label?: string;
};

export function BackButton({ label = 'Voltar' }: BackButtonProps) {
  const router = useRouter();

  return (
    <Button type="button" variant="secondary" onClick={() => router.back()}>
      ← {label}
    </Button>
  );
}
