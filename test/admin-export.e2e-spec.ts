import 'dotenv/config';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role } from '../generated/client';
import { AuditService } from '../src/audit/audit.service';
import { FirebaseService } from '../src/auth/firebase/firebase.service';
import { AdminFarmController } from '../src/farm/admin-farm.controller';
import { AdminFarmService } from '../src/farm/services/admin-farm.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { AdminOrderController } from '../src/order/admin-order.controller';
import { AdminOrderService } from '../src/order/admin-order.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

// Runs against the docker compose Postgres; test/e2e-guard.ts refuses a
// non-local DATABASE_URL. Firebase is faked: a token is the user's
// firebaseUid. The admin row is removed in afterAll.
const uid = `e2e-export-${randomUUID().slice(0, 8)}`;

describe('Admin CSV exports (e2e)', () => {
  let app: INestApplication<App>;
  let database: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [AdminFarmController, AdminOrderController],
      providers: [
        PrismaService,
        AuditService,
        AdminFarmService,
        AdminOrderService,
        // The exports never touch storage; the real service HEADs buckets on boot.
        { provide: StorageService, useValue: {} },
        {
          provide: FirebaseService,
          useValue: {
            auth: {
              verifyIdToken: (token: string) =>
                Promise.resolve({
                  uid: token,
                  exp: Math.floor(Date.now() / 1000) + 3600,
                }),
            },
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    database = app.get(PrismaService);
    await database.user.create({
      data: {
        firebaseUid: uid,
        firstName: 'Export',
        lastName: 'Admin',
        email: `${uid}@example.test`,
        role: Role.ADMIN,
        isVerified: true,
        admin: { create: {} },
      },
    });
  });

  afterAll(async () => {
    await database.user.deleteMany({ where: { firebaseUid: uid } });
    await app.close();
  });

  it('streams the farms CSV with its download headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/farms/export')
      .set('Authorization', `Bearer ${uid}`)
      .expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="farms.csv"',
    );
    expect(response.text.split('\r\n')[0]).toBe(
      'Farm Code,Farm Name,Farmer,Farmer ID,Phone,State,LGA,Main Produce,Size,Unit,Cluster,Products,Verification,Farmer Status,Registered',
    );
    expect(response.text.endsWith('\r\n')).toBe(true);
  });

  it('refuses paging on an export', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/farms/export?page=2')
      .set('Authorization', `Bearer ${uid}`)
      .expect(400);

    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', statusCode: 400 },
    });
  });

  it('answers a bad date range as JSON before any CSV is sent', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/orders/export?from=2026-10-10&to=2026-10-09')
      .set('Authorization', `Bearer ${uid}`)
      .expect(400);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      message: 'From must be on or before to',
      error: { code: 'VALIDATION_FAILED', statusCode: 400 },
    });
  });
});
