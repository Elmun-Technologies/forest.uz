'use client';

import type { MeDto } from '@forest/contracts';
import { formatTashkentDate, formatUzPhone } from '@forest/contracts/core';
import { Button, cn, Field, Input, inputClasses } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TelegramLink } from '@/components/account/telegram-link';
import { useToast } from '@/components/ui/toast';
import { ClientApiError, clientApi } from '@/lib/client-api';

/**
 * Name + message language, Telegram link (when the API has a bot or one is linked), data export
 * and deletion request (docs/02 "Customers & consent").
 */
export function ProfileForm({ me, telegramBot }: { me: MeDto; telegramBot: string | null }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const toast = useToast();
  const router = useRouter();
  // Telegram-only customers have no phone (the field is hidden for them).
  const phone = me.phone;
  const [name, setName] = useState(me.name ?? '');
  const [locale, setLocale] = useState(me.locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    try {
      await clientApi.me.update({ name: name.trim() || null, locale });
      toast(t('saved'), 'good');
      router.refresh();
    } catch (err) {
      toast(
        err instanceof ClientApiError && err.status < 500 ? err.message : tc('generic'),
        'critical',
      );
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    setBusy('export');
    try {
      const data = await clientApi.me.exportData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'forest-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast(tc('generic'), 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function requestDeletion() {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusy('delete');
    try {
      const r = await clientApi.me.requestDeletion();
      setDeletion(t('deleteRequested', { date: formatTashkentDate(new Date(r.dueBy)) }));
    } catch {
      toast(tc('generic'), 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={save}
        className="flex flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:p-10"
      >
        <h2 className="text-2xl font-medium tracking-[-0.03em]">{t('profile')}</h2>
        <Field label={t('name')}>
          {(p) => (
            <Input
              {...p}
              value={name}
              autoComplete="name"
              data-private
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        {phone ? (
          <Field label={t('phone')}>
            {(p) => (
              <Input {...p} value={formatUzPhone(phone)} readOnly className="bg-off" data-private />
            )}
          </Field>
        ) : null}
        <Field label={t('language')}>
          {(p) => (
            <select
              {...p}
              value={locale}
              onChange={(e) => setLocale(e.target.value === 'ru' ? 'ru' : 'uz')}
              className={cn(inputClasses, 'appearance-auto')}
            >
              <option value="uz">O&apos;zbekcha</option>
              <option value="ru">Русский</option>
            </select>
          )}
        </Field>
        <Button type="submit" loading={busy === 'save'} className="self-start">
          {t('save')}
        </Button>
      </form>
      <TelegramLink telegram={me.telegram} bot={telegramBot} />
      <section className="flex flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:p-10">
        <h2 className="text-2xl font-medium tracking-[-0.03em]">{t('data')}</h2>
        <p className="text-sm text-muted">{t('dataHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy === 'export'} onClick={() => void exportData()}>
            {t('export')}
          </Button>
          <Button
            variant="danger"
            loading={busy === 'delete'}
            onClick={() => void requestDeletion()}
          >
            {t('deleteRequest')}
          </Button>
        </div>
        <p role="status" className="text-sm font-semibold text-good">
          {deletion}
        </p>
      </section>
    </div>
  );
}
