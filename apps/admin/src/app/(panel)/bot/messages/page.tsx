import type { AdminMessageTemplateDto, MessagingSettingsDto } from '@forest/contracts';
import { hasPermission } from '@forest/contracts/core';
import { Badge, buttonClasses, cn, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  COPY,
  KIND_LABEL,
  KIND_TONE,
  SCENARIO_LABEL,
} from '../../../../components/bot-messages/copy';
import { MessagingSettingsForm } from '../../../../components/bot-messages/settings-form';
import { TemplateEditor } from '../../../../components/bot-messages/template-editor';
import { NoAccess, PageHeader } from '../../../../components/page';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: 'Xabarlar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

/** A12 messages (`bot.edit`): template list + editor (?key=, ?key=new) and messaging settings. */
export default async function BotMessagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'bot.edit')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const want = typeof sp.key === 'string' ? sp.key.slice(0, 64) : '';
  const [templates, settings] = await Promise.all([
    adminGet<AdminMessageTemplateDto[]>('/admin/messaging/templates'),
    adminGet<MessagingSettingsDto>('/admin/messaging/settings'),
  ]);
  const selected =
    want === 'new' ? null : (templates.find((t) => t.key === want) ?? templates[0] ?? null);

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={COPY.subtitle}
        actions={
          <Link
            href="/bot/messages?key=new"
            prefetch={false}
            className={buttonClasses('primary', 'md')}
            data-testid="template-new"
          >
            {COPY.newTemplate}
          </Link>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,480px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            as="section"
            className="flex min-w-0 flex-col gap-3 p-5 text-[13px] sm:p-[22px]"
            aria-labelledby="templates-title"
          >
            <h2 id="templates-title" className="text-xl font-semibold">
              {COPY.templates}
            </h2>
            {templates.length === 0 ? (
              <p className="rounded-md bg-off p-8 text-center text-muted">{COPY.emptyTemplates}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th scope="col" className="px-2 py-2 font-normal">
                        Shablon
                      </th>
                      <th scope="col" className="px-2 py-2 font-normal">
                        Ssenariy
                      </th>
                      <th scope="col" className="px-2 py-2 font-normal">
                        Turi
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-normal">
                        Yuborildi · {COPY.stats}
                      </th>
                      <th scope="col" className="px-2 py-2 font-normal">
                        Holat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <tr
                        key={t.key}
                        className={cn(
                          'border-b border-line-soft',
                          t.key === selected?.key && 'bg-[#F1F3EC]',
                        )}
                        data-testid="template-row"
                      >
                        <td className="px-2 py-2.5">
                          <Link
                            href={`/bot/messages?key=${encodeURIComponent(t.key)}`}
                            prefetch={false}
                            scroll={false}
                            aria-current={t.key === selected?.key ? 'true' : undefined}
                            className="flex flex-col focus-visible:outline-2 focus-visible:outline-forest"
                          >
                            <b className="font-semibold">{t.label}</b>
                            <span className="font-mono text-xs text-muted">{t.key}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-2.5">{SCENARIO_LABEL[t.scenario]}</td>
                        <td className="px-2 py-2.5">
                          <Badge tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
                        </td>
                        <td className="tabular px-2 py-2.5 text-right">
                          {t.stats.sent}
                          {t.stats.skipped > 0 ? (
                            <span className="block text-[11px] text-muted">
                              {t.stats.skipped} {COPY.skipped}
                            </span>
                          ) : null}
                        </td>
                        <td className="flex flex-wrap gap-1 px-2 py-2.5">
                          <Badge tone={t.active ? 'good' : 'neutral'}>
                            {t.active ? 'Faol' : "O'chiq"}
                          </Badge>
                          {t.channels.includes('SMS') ? (
                            <Badge tone={t.smsApproved ? 'sage' : 'warn'}>
                              {t.smsApproved ? 'Eskiz ✓' : 'Eskiz ?'}
                            </Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <MessagingSettingsForm
            key={settings.version}
            settings={settings}
            canManageBot={hasPermission(me.staff.role, 'integrations.view')}
          />
        </div>
        <TemplateEditor key={selected?.key ?? 'new'} template={selected} />
      </div>
    </>
  );
}
