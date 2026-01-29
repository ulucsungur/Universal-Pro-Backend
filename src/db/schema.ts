import {
  pgTable,
  text,
  timestamp,
  bigint,
  numeric,
  integer,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Rol Tanımları
export const roleEnum = pgEnum('user_role', ['admin', 'agent', 'user']);

// 2. USERS (Kullanıcılar)
export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  fullName: text('full_name').notNull(),
  email: text('email').unique().notNull(),
  password: text('password'),
  role: roleEnum('role').default('user').notNull(),
  avatarUrl: text('avatar_url'),
  githubId: text('github_id').unique(),
  googleId: text('google_id').unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3. CATEGORIES (Kategoriler)
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  title: text('title'), // Geçici olarak koruyoruz
  titleTr: text('title_tr'),
  titleEn: text('title_en'),
  slug: text('slug').unique().notNull(),
  imageUrl: text('image_url'),
  parentId: bigint('parent_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// 4. LISTINGS (İlanlar)
export const listings = pgTable('listings', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  title: text('title').notNull(), // Varsayılan başlık
  titleTr: text('title_tr'), // 🚀 Yeni
  titleEn: text('title_en'), // 🚀 Yeni
  description: text('description'),
  descriptionTr: text('description_tr'), // 🚀 Yeni
  descriptionEn: text('description_en'), // 🚀 Yeni
  price: numeric('price').notNull(),
  currency: text('currency').default('TRY'),
  imageUrls: text('image_urls').array().default([]),
  specs: jsonb('specs').default({}),
  categoryId: bigint('category_id', { mode: 'number' }).references(
    () => categories.id,
  ),
  sellerId: integer('seller_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- İLİŞKİLER (RELATIONS) ---
export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings),
}));

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  listings: many(listings),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'sub_categories',
  }),
  subCategories: many(categories, { relationName: 'sub_categories' }),
}));

export const listingsRelations = relations(listings, ({ one }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [listings.categoryId],
    references: [categories.id],
  }),
}));
