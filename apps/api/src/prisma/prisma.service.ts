import { Global, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@forest/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // Last shutdown phase: BullMQ workers stop first (`WorkerShutdown`), so no job loses its
  // connection mid-transaction.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
