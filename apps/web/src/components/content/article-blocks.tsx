import type { ArticleBlockDto } from '@forest/contracts';
import { cn } from '@forest/ui';
import Image from 'next/image';

/** Rendered CMS blocks (articles, brand story); never `dangerouslySetInnerHTML`. */
export function ArticleBlocks({
  blocks,
  className,
}: {
  blocks: ArticleBlockDto[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-5 text-[15px] leading-[1.7] text-[#2A2E26] lg:text-base',
        className,
      )}
    >
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

function Block({ block: b }: { block: ArticleBlockDto }) {
  switch (b.type) {
    case 'h2':
      return (
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.03em] text-ink lg:text-[30px]">
          {b.text}
        </h2>
      );
    case 'h3':
      return <h3 className="mt-1 text-lg font-semibold text-ink">{b.text}</h3>;
    case 'p':
      return <p className="whitespace-pre-line">{b.text}</p>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={cn(
            'flex flex-col gap-1.5 pl-[22px]',
            b.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {b.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </Tag>
      );
    }
    case 'dl':
      return (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-[20px] bg-off px-6 py-5 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
          {b.items.map((d, i) => (
            <div key={i} className="contents">
              <dt className="text-muted">{d.term}</dt>
              <dd className="font-semibold text-ink">{d.desc}</dd>
            </div>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-[20px] border border-line">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="bg-off text-left text-xs text-muted">
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className="px-[18px] py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i} className="border-t border-line-soft">
                  {row.map((cell, j) => (
                    <td key={j} className="px-[18px] py-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'note':
      return (
        <p
          className={cn(
            'rounded-[20px] px-5 py-4 text-sm',
            b.tone === 'warn' ? 'bg-warn-bg text-warn' : 'bg-sage-50 text-ink-2',
          )}
        >
          {b.text}
        </p>
      );
    case 'faq':
      return (
        <div className="flex flex-col divide-y divide-line">
          {b.items.map((f, i) => (
            <details key={i} className="py-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink">
                {f.q}
              </summary>
              <p className="pt-1">{f.a}</p>
            </details>
          ))}
        </div>
      );
    case 'quote':
      return (
        <blockquote className="border-l-[3px] border-forest pl-5 text-xl leading-snug font-medium tracking-[-0.02em] text-ink lg:text-2xl">
          <p>{b.text}</p>
          {b.cite ? (
            <footer className="mt-2 text-sm font-normal text-muted">— {b.cite}</footer>
          ) : null}
        </blockquote>
      );
    case 'image':
      return (
        <figure className="flex flex-col gap-2">
          <Image
            src={b.image.url}
            alt={b.image.alt}
            width={b.image.width ?? 1200}
            height={b.image.height ?? 800}
            sizes="(min-width: 1024px) 760px, 100vw"
            className="h-auto w-full rounded-[24px] object-cover"
          />
          {b.caption ? (
            <figcaption className="text-[13px] text-muted">{b.caption}</figcaption>
          ) : null}
        </figure>
      );
  }
}
