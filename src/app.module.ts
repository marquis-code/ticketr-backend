import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { EventModule } from './event/event.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { PaystackModule } from './paystack/paystack.module';
import { ResendModule } from './resend/resend.module';
import { OrderModule } from './order/order.module';
import { TicketModule } from './ticket/ticket.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RedisModule } from './redis/redis.module';
import { SeedService } from './seed.service';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Event, EventSchema } from './schemas/event.schema';
import { TicketTier, TicketTierSchema } from './schemas/ticket-tier.schema';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        let uri = configService.get<string>('MONGODB_URI');
        if (!uri || uri.includes('localhost:27017')) {
          try {
            const mongod = await MongoMemoryServer.create();
            uri = mongod.getUri();
            console.log(`🍃 Embedded MongoDB Memory Server started at ${uri}`);
          } catch (e) {
            console.warn(`MongoMemoryServer notice: ${e.message}, defaulting to Mongo URI.`);
            uri = uri || 'mongodb://localhost:27017/cmultickets_db';
          }
        }
        return { uri };
      },
    }),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: Event.name, schema: EventSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
    ]),
    RedisModule,
    AuthModule,
    TenantModule,
    EventModule,
    CloudinaryModule,
    PaystackModule,
    ResendModule,
    OrderModule,
    TicketModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService, SeedService],
})
export class AppModule {}
