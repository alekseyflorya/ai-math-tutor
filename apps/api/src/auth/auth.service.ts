import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { Locale, LoginInput, RegisterInput, UserView } from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { users, type User } from '../db/schema';
import { DemoSeeder } from './demo.seeder';

@Injectable()
export class AuthService {
  // Verifying against a real hash when the email is unknown keeps failed logins equally
  // slow for known and unknown emails (no account enumeration via timing).
  private readonly dummyHash = hash('timing-equalizer-not-a-real-password');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly demo: DemoSeeder,
  ) {}

  async register(input: RegisterInput): Promise<User> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'This email is already registered' });
    const [user] = await this.db
      .insert(users)
      .values({ email: input.email, name: input.name, locale: input.locale, passwordHash: await hash(input.password) })
      .returning();
    return user!;
  }

  async login(input: LoginInput): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(() => false);
    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Wrong email or password' });
    }
    return user;
  }

  /**
   * One click for reviewers: a fresh, isolated demo student with a bit of history,
   * so the progress dashboard is not empty and nobody shares state with anyone else.
   */
  async createDemoUser(locale: Locale): Promise<User> {
    const [user] = await this.db
      .insert(users)
      .values({ name: locale === 'uk' ? 'Демо-учень' : 'Demo student', isDemo: true, locale })
      .returning();
    await this.demo.seedHistory(user!.id);
    return user!;
  }

  async getUser(id: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Please sign in' });
    return user;
  }

  async setLocale(id: string, locale: Locale): Promise<User> {
    const [user] = await this.db.update(users).set({ locale }).where(eq(users.id, id)).returning();
    return user!;
  }

  signSession(user: User): Promise<string> {
    return this.jwt.signAsync({ sub: user.id });
  }

  toView(user: User): UserView {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isDemo: user.isDemo,
      locale: user.locale === 'uk' ? 'uk' : 'en',
    };
  }
}
