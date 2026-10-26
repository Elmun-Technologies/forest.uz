import { Controller, Get, Header, Injectable, Logger, Module, Query } from '@nestjs/common';
import {
  type CategoryDto,
  type Locale,
  type SearchQuery,
  type SearchResultDto,
  normalizeSearch,
  searchQuerySchema,
} from '@forest/contracts';
import { CatalogModule } from '../../catalog/catalog.module';
import { CatalogService } from '../../catalog/catalog.service';
import { ReqLocale, ZodPipe } from '../../common/http';
import { maskPhonesInText } from '../../common/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerCommonModule } from '../common/customer-common.module';
import { buildSearchTerms, queryTokens } from './search-terms';

const MAX_CATEGORIES = 3;
const MAX_SUGGESTIONS = 5;

@Injectable()
export class SearchService {
  private readonly logger = new Logger('Search');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async search(q: SearchQuery, locale: Locale): Promise<SearchResultDto> {
    const normalized = normalizeSearch(q.q);
    if (!normalized) return { query: q.q, products: [], categories: [], suggestions: [] };

    const tokens = queryTokens(normalized);
    const synonymRows = await this.prisma.searchSynonym.findMany({
      where: { term: { in: [normalized, ...tokens] } },
    });
    const terms = buildSearchTerms(
      normalized,
      new Map(synonymRows.map((s) => [s.term, s.synonyms])),
    );

    const ids = terms.length ? await this.matchProducts(terms, q.limit) : [];
    const products = await this.catalog.byIds(ids, locale);
    const categories = await this.matchCategories(tokens, products, locale);
    const suggestions = products.length ? [] : await this.suggest(normalized, categories, locale);

    await this.log(q.q, locale, products.length);
    return { query: q.q, products, categories, suggestions };
  }

  /**
   * `<%` is pg_trgm word similarity (served by the GIN trigram index on searchText): it tolerates
   * typos and inflection ("divana" ~ "divan"); ILIKE catches short prefixes while typing.
   * Score sums matched terms so products matching more of the query rank first.
   */
  private async matchProducts(
    terms: { term: string; weight: number }[],
    limit: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM "Product" p
      CROSS JOIN unnest(${terms.map((t) => t.term)}::text[], ${terms.map((t) => t.weight)}::float8[]) AS t(term, weight)
      WHERE p.status = 'ACTIVE'
        AND (t.term <% p."searchText" OR p."searchText" ILIKE '%' || t.term || '%')
      GROUP BY p.id
      ORDER BY SUM(t.weight * word_similarity(t.term, p."searchText")) DESC, MAX(p.popularity) DESC, p.id
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  private async matchCategories(
    tokens: string[],
    products: SearchResultDto['products'],
    locale: Locale,
  ): Promise<CategoryDto[]> {
    const all = await this.catalog.categories(locale);
    const byName = all.filter((c) => {
      const words = normalizeSearch(`${c.name} ${c.slug.replace(/-/g, ' ')}`).split(' ');
      return tokens.some((tok) =>
        words.some((w) => w.startsWith(tok) || (tok.length >= 4 && tok.startsWith(w))),
      );
    });
    const fromProducts = products
      .map((p) => all.find((c) => c.slug === p.categorySlug))
      .filter((c): c is CategoryDto => Boolean(c));
    return [...new Map([...byName, ...fromProducts].map((c) => [c.id, c])).values()].slice(
      0,
      MAX_CATEGORIES,
    );
  }

  /** Zero results: "did you mean" dictionary terms close to the query, then category names. */
  private async suggest(
    normalized: string,
    categories: CategoryDto[],
    locale: Locale,
  ): Promise<string[]> {
    const close = await this.prisma.$queryRaw<{ term: string }[]>`
      SELECT term FROM "SearchSynonym"
      WHERE similarity(term, ${normalized}) > 0.3
      ORDER BY similarity(term, ${normalized}) DESC
      LIMIT 3`;
    const cats = categories.length ? categories : await this.catalog.categories(locale);
    return [...new Set([...close.map((r) => r.term), ...cats.map((c) => c.name)])].slice(
      0,
      MAX_SUGGESTIONS,
    );
  }

  private async log(query: string, locale: Locale, results: number): Promise<void> {
    try {
      await this.prisma.searchQueryLog.create({
        // Shoppers sometimes paste phone numbers into search: never store them.
        data: { query: maskPhonesInText(query.toLowerCase()).slice(0, 100), locale, results },
      });
    } catch (e) {
      this.logger.warn(`search log failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

@Controller('catalog')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  @Header('Cache-Control', 'public, max-age=30')
  find(
    @Query(new ZodPipe(searchQuerySchema)) q: SearchQuery,
    @ReqLocale() locale: Locale,
  ): Promise<SearchResultDto> {
    return this.search.search(q, locale);
  }
}

@Module({
  imports: [CatalogModule, CustomerCommonModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
