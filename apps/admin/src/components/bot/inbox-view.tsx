'use client';

import type {
  AdminBotConversationDto,
  AdminBotConversationListDto,
  AdminBotConversationRowDto,
  AdminVariantOptionDto,
  BotConversationStatus,
} from '@forest/contracts/core';
import { BOT_CONVERSATION_STATUSES, BOT_LIMITS } from '@forest/contracts/core';
import { Badge, Button, cn, Input, Panel, Textarea } from '@forest/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { COPY, STATUS_LABEL, STATUS_TONE, TOPIC_LABEL } from './copy';
import { AiReplyButton } from '../automation/ai-reply-button';

const soum = (n: number) => `${n.toLocaleString('ru-RU').replace(/\s/g, ' ')} so'm`;

function href(status: string, c?: string | null) {
  const q = new URLSearchParams();
  if (status !== 'all') q.set('status', status);
  if (c) q.set('c', c);
  const s = q.toString();
  return `/bot/inbox${s ? `?${s}` : ''}`;
}

/** A12 operator inbox: list by status + thread with reply, product card, assignment, close. */
export function InboxView({
  list,
  status,
  selected,
  canSeeCustomers,
}: {
  list: AdminBotConversationListDto;
  status: string;
  selected: AdminBotConversationDto | null;
  canSeeCustomers: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(list.items);
  const [cursor, setCursor] = useState(list.nextCursor);

  // New messages arrive through the webhook: refresh the server data every 20 s while visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [router]);

  async function more() {
    if (!cursor) return;
    const page = await adminFetch<AdminBotConversationListDto>(
      `/admin/bot/conversations?status=${status}&limit=40&cursor=${encodeURIComponent(cursor)}`,
    );
    setItems((xs) => [...xs, ...page.items]);
    setCursor(page.nextCursor);
  }

  const tabs: ('all' | BotConversationStatus)[] = ['all', ...BOT_CONVERSATION_STATUSES];
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <Panel as="section" className="flex flex-col gap-3 p-4" aria-label={COPY.inboxTitle}>
        <nav aria-label="Suhbat holati" className="flex flex-wrap gap-1.5">
          {tabs.map((s) => (
            <Link
              key={s}
              href={href(s)}
              prefetch={false}
              aria-current={status === s ? 'page' : undefined}
              data-testid={`inbox-tab-${s}`}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] font-semibold',
                status === s ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage-50',
              )}
            >
              {s === 'all' ? COPY.allStatuses : STATUS_LABEL[s]}
              <span className={status === s ? 'text-on-dark-muted' : 'text-muted'}>
                {list.counts[s]}
              </span>
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted">{COPY.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((c) => (
              <ConversationRow key={c.id} c={c} active={c.id === selected?.id} status={status} />
            ))}
          </ul>
        )}
        {cursor ? (
          <Button variant="outline" size="sm" onClick={() => void more()}>
            {COPY.more}
          </Button>
        ) : null}
      </Panel>
      {selected ? (
        <Thread
          key={selected.id}
          initial={selected}
          canSeeCustomers={canSeeCustomers}
          onChanged={() => router.refresh()}
        />
      ) : (
        <Panel className="p-8 text-center text-[13px] text-muted">{COPY.pick}</Panel>
      )}
    </div>
  );
}

function ConversationRow({
  c,
  active,
  status,
}: {
  c: AdminBotConversationRowDto;
  active: boolean;
  status: string;
}) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={href(status, c.id)}
        prefetch={false}
        aria-current={active ? 'true' : undefined}
        data-testid="inbox-row"
        className={cn(
          'flex items-start gap-3 rounded-md px-2 py-3 transition-colors',
          active ? 'bg-sage-50' : 'hover:bg-canvas',
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-sage text-[13px] font-bold text-forest">
          {c.initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <b className="truncate text-[14px]">{c.title}</b>
            <span className="text-[12px] text-muted">{TOPIC_LABEL[c.topic]}</span>
          </span>
          <span className="truncate text-[13px] text-muted">
            {c.preview || (c.hasPhoto ? `[${COPY.photo.toLowerCase()}]` : '')}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[12px] text-muted">{formatWhen(c.lastMessageAt)}</span>
          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        </span>
      </Link>
    </li>
  );
}

function Thread({
  initial,
  canSeeCustomers,
  onChanged,
}: {
  initial: AdminBotConversationDto;
  canSeeCustomers: boolean;
  onChanged: () => void;
}) {
  const [conv, setConv] = useState(initial);
  const [text, setText] = useState('');
  const [product, setProduct] = useState<AdminVariantOptionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Newer browsers return a Promise from scrollIntoView: never hand it to React as a cleanup.
    void end.current?.scrollIntoView({ block: 'end' });
  }, [conv.messages.length]);

  async function act(path: string, method: 'POST' | 'PATCH', body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const next = await adminFetch<AdminBotConversationDto>(path, { method, body });
      setConv(next);
      onChanged();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const ok = await act(`/admin/bot/conversations/${conv.id}/reply`, 'POST', {
      text: text.trim(),
      ...(product ? { product: { variantId: product.id, qty: 1 } } : {}),
    });
    if (ok) {
      setText('');
      setProduct(null);
    }
  }

  return (
    <Panel as="section" className="flex flex-col gap-4 p-5" aria-label={conv.title}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex flex-col">
          <h2 className="text-xl font-semibold">{conv.title}</h2>
          <span className="text-[12px] text-muted">
            {TOPIC_LABEL[conv.topic]} ·{' '}
            <Badge tone={STATUS_TONE[conv.status]}>{STATUS_LABEL[conv.status]}</Badge>
          </span>
        </div>
        {conv.customer && canSeeCustomers ? (
          <Link
            href={`/customers/${conv.customer.id}`}
            prefetch={false}
            className="text-[13px] font-semibold underline"
          >
            {COPY.customer} {conv.customer.publicId}
          </Link>
        ) : null}
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">{COPY.assignee}</span>
          <select
            className="h-9 rounded-pill border border-line bg-panel px-3"
            value={conv.assignee?.id ?? ''}
            disabled={busy}
            onChange={(e) =>
              void act(`/admin/bot/conversations/${conv.id}`, 'PATCH', {
                assigneeId: e.target.value || null,
              })
            }
            data-testid="inbox-assignee"
          >
            <option value="">{COPY.unassigned}</option>
            {conv.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {conv.assignee && !conv.operators.some((o) => o.id === conv.assignee!.id) ? (
              <option value={conv.assignee.id}>{conv.assignee.name}</option>
            ) : null}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          data-testid="inbox-close"
          onClick={() =>
            void act(`/admin/bot/conversations/${conv.id}`, 'PATCH', {
              status: conv.status === 'CLOSED' ? 'OPEN' : 'CLOSED',
            })
          }
        >
          {conv.status === 'CLOSED' ? COPY.reopen : COPY.close}
        </Button>
      </header>

      <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto rounded-md bg-canvas p-3">
        {conv.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex max-w-[80%] flex-col gap-1 rounded-md px-3 py-2 text-[14px]',
              m.fromCustomer ? 'self-end bg-[#E3F2D3]' : 'self-start bg-panel',
            )}
          >
            {!m.fromCustomer && m.staffName ? (
              <span className="text-[12px] font-semibold text-forest">{m.staffName}</span>
            ) : null}
            {m.photos.map((p) => (
              <a key={p.fileId} href={p.url} target="_blank" rel="noreferrer">
                {/* Signed private URL (10 min); next/image can't optimise it. */}
                <img src={p.url} alt={COPY.photo} className="max-h-64 rounded-sm object-contain" />
              </a>
            ))}
            {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
            {m.product ? (
              <span className="rounded-sm border border-line bg-canvas px-2 py-1 text-[13px]">
                {m.product.name}
                {m.product.priceSoum !== null ? ` · ${soum(m.product.priceSoum)}` : ''}
              </span>
            ) : null}
            <span className="self-end text-[11px] text-muted">{formatWhen(m.createdAt)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>

      {conv.canReply ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="bot-reply" className="text-[13px] font-semibold">
            {COPY.reply}
          </label>
          <Textarea
            id="bot-reply"
            rows={3}
            maxLength={BOT_LIMITS.replyMax}
            value={text}
            placeholder={COPY.replyPlaceholder}
            onChange={(e) => setText(e.target.value)}
            data-testid="inbox-reply"
          />
          <ProductPicker value={product} onChange={setProduct} />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={busy || (!text.trim() && !product)}
              data-testid="inbox-send"
            >
              {busy ? COPY.sending : COPY.send}
            </Button>
            <AiReplyButton conversationId={conv.id} onDraft={setText} disabled={busy} />
            {error ? (
              <span role="alert" className="text-[13px] text-critical">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="text-[13px] text-muted">{COPY.cannotReply}</p>
      )}
    </Panel>
  );
}

function ProductPicker({
  value,
  onChange,
}: {
  value: AdminVariantOptionDto | null;
  onChange: (v: AdminVariantOptionDto | null) => void;
}) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<AdminVariantOptionDto[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    const id = window.setTimeout(() => {
      adminFetch<AdminVariantOptionDto[]>(`/admin/bot/variants?q=${encodeURIComponent(q)}`)
        .then(setOptions)
        .catch(() => setOptions([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [q]);

  if (value)
    return (
      <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-[13px]">
        <span className="flex-1">
          {COPY.product}: <b>{value.name}</b> {value.label} · {soum(value.priceSoum)}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {COPY.removeProduct}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={COPY.productSearch}
        placeholder={COPY.productSearch}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="inbox-product-search"
      />
      {options.length ? (
        <ul className="flex flex-col rounded-md border border-line bg-panel">
          {options.slice(0, 8).map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] hover:bg-canvas"
                onClick={() => {
                  onChange(o);
                  setQ('');
                }}
              >
                {o.name} {o.label} · {soum(o.priceSoum)} <span className="text-muted">{o.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
