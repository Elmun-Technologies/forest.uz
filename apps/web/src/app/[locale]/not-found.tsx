import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('errors');
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-[44px] font-medium tracking-[-0.05em]">404</h1>
      <p className="mt-4 text-muted">{t('notFound')}</p>
    </main>
  );
}
