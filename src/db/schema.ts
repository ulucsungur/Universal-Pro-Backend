import {
  pgTable,
  text,
  timestamp,
  bigint,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';

// 1. Rolleri Sabitle
export const roleEnum = pgEnum('user_role', ['admin', 'agent', 'user']);

// 2. USERS: Veritabanı isimlerini tırnak içinde belirterek eşleşmeyi sağladık
export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  fullName: text('full_name').notNull(),
  email: text('email').unique().notNull(),
  password: text('password'),
  role: roleEnum('role').default('user').notNull(),
  avatarUrl: text('avatar_url'),
  githubId: text('github_id').unique(),
  googleId: text('google_id').unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3. CATEGORIES: title_tr ve title_en eklendi
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  title: text('title'), // Veri kaybını önlemek için eskisi bir süre kalsın
  titleTr: text('title_tr'),
  titleEn: text('title_en'),
  slug: text('slug').unique().notNull(),
  imageUrl: text('image_url'),
  parentId: bigint('parent_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// 4. LISTINGS: Price hatasını SQL'de çözdük, burada mühürlüyoruz
export const listings = pgTable('listings', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  title: text('title').notNull(),
  description: text('description'),
  // TS hatasını önlemek için numeric'ten sonra tipini sabitledik
  price: numeric('price').notNull(),
  currency: text('currency').default('TRY'),
  imageUrls: text('image_urls').array().default([]),
  specs: text('specs'),
  categoryId: bigint('category_id', { mode: 'number' }).references(
    () => categories.id,
  ),
  createdAt: timestamp('created_at').defaultNow(),
});
