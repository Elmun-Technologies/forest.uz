import { Module } from '@nestjs/common';

/**
 * Customer-facing modules (OTP auth & sessions, /me, leads, waitlist, search, content, SEO feeds).
 * Aggregated here so app.module stays stable while this area grows.
 */
@Module({ imports: [] })
export class CustomerModule {}
