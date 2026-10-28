import type { Metadata } from 'next';
import { EditorPage } from '../../editor-page';

export const metadata: Metadata = { title: 'Yangi maqola · Forest Admin' };

export default function NewArticlePage() {
  return <EditorPage mode="create" />;
}
