import { type AdminArticleDto, hasPermission } from '@forest/contracts/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleEditor, type ProductOption } from '../../../components/content/article-editor';
import { NoAccess, PageHeader } from '../../../components/page';
import { AdminApiError, adminGet, requireFullSession } from '../../../lib/api';

const SITE_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Shared loader for the article / brand editor routes. */
export async function EditorPage({
  mode,
  slug,
}: {
  mode: 'create' | 'edit' | 'brand';
  slug?: string;
}) {
  const me = await requireFullSession();
  const title = mode === 'brand' ? 'Brend sahifasi' : mode === 'create' ? 'Yangi maqola' : 'Maqola';
  if (!hasPermission(me.staff.role, 'content.edit'))
    return (
      <>
        <PageHeader title={title} />
        <NoAccess />
      </>
    );
  let article: AdminArticleDto;
  try {
    article =
      mode === 'brand'
        ? await adminGet<AdminArticleDto>('/admin/content/brand')
        : mode === 'edit'
          ? await adminGet<AdminArticleDto>(`/admin/content/articles/${slug}`)
          : blank();
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  }
  const products = await adminGet<ProductOption[]>('/admin/products/options');
  return (
    <>
      <PageHeader
        title={
          mode === 'edit' ? article.locales.uz.title || article.locales.ru.title || title : title
        }
        subtitle={
          <>
            <Link href="/content" prefetch={false} className="hover:text-ink">
              Ilhom va Brend
            </Link>{' '}
            /{' '}
            {mode === 'brand'
              ? "«Bizning yo'l» bo'limi: nashr qilinmaguncha saytda ko'rinmaydi"
              : 'UZ va RU alohida nashr qilinadi'}
          </>
        }
      />
      <ArticleEditor article={article} mode={mode} products={products} siteUrl={SITE_URL} />
    </>
  );
}

function blank(): AdminArticleDto {
  const l = (locale: 'uz' | 'ru') => ({
    locale,
    exists: false,
    published: false,
    title: '',
    excerpt: '',
    blocks: [],
    seoTitle: '',
    seoDescription: '',
    updatedAt: null,
  });
  return {
    kind: 'ARTICLE',
    slug: '',
    category: null,
    cover: null,
    videoUrl: null,
    videoMinutes: null,
    readingMinutes: null,
    sort: 0,
    relatedProductIds: [],
    publishedAt: null,
    locales: { uz: l('uz'), ru: l('ru') },
    files: {},
  };
}
