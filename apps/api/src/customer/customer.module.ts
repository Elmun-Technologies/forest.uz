import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ContentModule } from './content/content.module';
import { LeadsModule } from './leads/leads.module';
import { MeModule } from './me/me.module';
import { SearchModule } from './search/search.module';
import { SeoModule } from './seo/seo.module';

/**
 * Customer-facing modules (OTP auth & sessions, /me, leads, waitlist, search, content, SEO feeds).
 * Aggregated here so app.module stays stable while this area grows.
 */
@Module({ imports: [AuthModule, MeModule, LeadsModule, SearchModule, ContentModule, SeoModule] })
export class CustomerModule {}
