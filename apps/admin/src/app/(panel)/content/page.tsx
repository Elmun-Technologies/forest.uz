import { type AdminArticleListDto, hasPermission } from '@forest/contracts/core';
import { Badge, Button, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CATEGORY_LABEL } from '../../../components/content/copy';
import { NoAccess, PageHeader } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';
import { formatWhen } from '../../../lib/format';

export const metadata: Metadata = { title: 'Ilhom va Brend · Forest Admin' };

/** Ilhom articles + Brend story list (`content.edit`, O/M/Mk). */
export default async function ContentPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'content.edit'))
    return (
      <>
        <PageHeader title="Ilhom va Brend" />
        <NoAccess />
      </>
    );
  const { items } = await adminGet<AdminArticleListDto>('/admin/content/articles');
  const articles = items.filter((i) => i.kind === 'ARTICLE');
  return (
    <>
      <PageHeader
        title="Ilhom va Brend"
        subtitle="Maqolalar, video darslar va brend sahifasi · UZ/RU alohida nashr qilinadi"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/content/brand" prefetch={false}>
                Brend sahifasi
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/content/articles/new" prefetch={false} data-testid="article-new">
                + Maqola
              </Link>
            </Button>
          </div>
        }
      />
      <Panel className="p-5 text-[13px] sm:p-[22px]">
        {articles.length === 0 ? (
          <p className="py-8 text-center text-muted">Hali maqola yo&apos;q. Birinchisini yozing.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" data-testid="article-list">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Sarlavha</th>
                  <th className="py-2 font-medium">Bo&apos;lim</th>
                  <th className="py-2 font-medium">UZ</th>
                  <th className="py-2 font-medium">RU</th>
                  <th className="py-2 font-medium">O&apos;zgartirilgan</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.slug} className="border-t border-line-soft">
                    <td className="py-2.5">
                      <Link
                        href={`/content/articles/${a.slug}`}
                        prefetch={false}
                        className="font-semibold hover:underline"
                      >
                        {a.title}
                      </Link>
                      <div className="font-mono text-xs text-muted">/ilhom/{a.slug}</div>
                    </td>
                    <td className="py-2.5">{a.category ? CATEGORY_LABEL[a.category] : '—'}</td>
                    {(['uz', 'ru'] as const).map((l) => (
                      <td key={l} className="py-2.5">
                        <Badge
                          tone={a.published[l] ? 'good' : 'neutral'}
                          className="h-5 text-[11px]"
                        >
                          {a.published[l] ? 'Saytda' : 'Qoralama'}
                        </Badge>
                      </td>
                    ))}
                    <td className="py-2.5">{formatWhen(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
