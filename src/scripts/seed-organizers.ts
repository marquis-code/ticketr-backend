import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../schemas/user.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const userModel: Model<any> = app.get(getModelToken('User'));
  const tenantModel: Model<any> = app.get(getModelToken('Tenant'));

  console.log('Seeding organizers...');

  let tenant = await tenantModel.findOne(); // Assumes single tenant for now based on context
  if (!tenant) {
    tenant = await tenantModel.create({
      name: 'The Big 5',
      slug: 'thebig5',
      contactEmail: 'thebig5@ticketr.org',
    });
    console.log('Created missing tenant');
  } else {
    console.log(`Found tenant: ${tenant.name}`);
  }

  const usersToSeed = [
    { email: 'ulsesa01@gmail.com', role: UserRole.ORGANIZER },
    { email: 'efsaunilag@gmail.com', role: UserRole.ORGANIZER },
    { email: 'emsaunilag0@gmail.com', role: UserRole.ORGANIZER },
    { email: 'naaes.universityoflagos@gmail.com', role: UserRole.ORGANIZER },
    { email: 'tvesaunilag@gmail.com', role: UserRole.ORGANIZER },
    { email: 'abahmarquis@gmail.com', role: UserRole.SUPER_ADMIN },
  ];

  for (const { email, role } of usersToSeed) {
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      console.log(`User ${email} already exists.`);
      continue;
    }

    const namePart = email.split('@')[0];
    const password = `${namePart.charAt(0).toUpperCase() + namePart.slice(1)}@2026!`;
    const passwordHash = await bcrypt.hash(password, 10);

    await userModel.create({
      name: namePart,
      email,
      passwordHash,
      role: role,
      tenantId: tenant._id,
      isActive: true,
    });
    console.log(`Created user ${email} with password: ${password}`);
  }

  console.log('Seeding completed.');
  process.exit(0);
}

bootstrap();
