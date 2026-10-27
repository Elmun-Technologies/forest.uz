import { revalidateTag } from 'next/cache';
import {
  isRevalidateTag,
  verifyWebSignature,
  WEB_CONTEXTS,
  WEB_SIGNATURE_HEADER,
} from '@/lib/web-signature';

// A filesystem route wins over the `/api/*` → API rewrite (next.config.ts), so this is handled
// here. Only the API calls it (signed); Caddy also refuses it from outside (infra/Caddyfile).
export const dynamic = 'force-dynamic';

const MAX_TAGS = 50;
const MAX_BYTES = 20_000;

/** Reads at most `MAX_BYTES` (null = larger): a declared or streamed oversize body is never buffered. */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES || !req.body) return declared > MAX_BYTES ? null : '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request): Promise<Response> {
  const body = await readCapped(req);
  if (body === null) return Response.json({ error: 'too large' }, { status: 413 });
  if (!verifyWebSignature(WEB_CONTEXTS.revalidate, req.headers.get(WEB_SIGNATURE_HEADER), body))
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
