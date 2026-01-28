import { pgTable, text, timestamp, bigint, pgEnum } from 'drizzle-orm/pg-core';

// 1. Kullanıcı Rollerini Tanımlayalım
export const roleEnum = pgEnum('user_role', ['admin', 'agent', 'user']);

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

// Kategoriler (Supabase'deki mevcut int8 yapısıyla eşitledik)
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  slug: text('slug').unique().notNull(),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

// İlanlar (Supabase'deki mevcut int8 yapısıyla eşitledik)
export const listings = pgTable('listings', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  description: text('description'),
  price: text('price').notNull(),
  currency: text('currency').default('TRY'),
  imageUrls: text('image_urls').array().default([]),
  createdAt: timestamp('created_at').defaultNow(),
});
