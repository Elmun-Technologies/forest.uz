import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorPage } from '../../editor-page';

export const metadata: Metadata = { title: 'Maqola · Forest Admin' };

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,96}$/.test(slug)) notFound();
  return <EditorPage mode="edit" slug={slug} />;
}
