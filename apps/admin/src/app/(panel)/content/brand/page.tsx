import type { Metadata } from 'next';
import { EditorPage } from '../editor-page';

export const metadata: Metadata = { title: 'Brend sahifasi · Forest Admin' };

export default function BrandPage() {
  return <EditorPage mode="brand" />;
}
