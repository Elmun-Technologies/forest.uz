import { revalidateTag } from 'next/cache';
import { isRevalidateTag, verifyRevalidateSignature } from '@/lib/revalidate-auth';

// A filesystem route wins over the `/api/*` → API rewrite (next.config.ts), so this is handled
// here. Only the API calls it (signed); Caddy also refuses it from outside (infra/Caddyfile).
export const dynamic = 'force-dynamic';

const MAX_TAGS = 50;

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  if (
    body.length > 20_000 ||
    !verifyRevalidateSignature(req.headers.get('x-forest-signature'), body)
  )
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  let tags: unknown;
  try {
    tags = (JSON.parse(body) as { tags?: unknown }).tags;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every(isRevalidateTag))
    return Response.json({ error: 'bad request' }, { status: 400 });
  for (const tag of new Set(tags)) revalidateTag(tag);
  return Response.json({ revalidated: tags.length });
}
