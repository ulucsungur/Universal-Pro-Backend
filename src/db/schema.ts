import {
  pgTable,
  text,
  timestamp,
  bigint,
  numeric,
  serial,
} from 'drizzle-orm/pg-core'; // serial BURAYA EKLENDİ

// 1. Kategoriler
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').unique().notNull(),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. İlanlar
export const listings = pgTable('listings', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  price: numeric('price').notNull(),
  currency: text('currency').default('TRY'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3. Kullanıcılar (Giriş Sistemi İçin)
export const users = pgTable('users', {
  id: serial('id').primaryKey(), // Artık hata vermeyecek
  fullName: text('full_name').notNull(),
  email: text('email').unique().notNull(),
  password: text('password').notNull(),
  role: text('role').default('user').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow(),
});
