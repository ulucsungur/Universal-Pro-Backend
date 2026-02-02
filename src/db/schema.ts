import {
  pgTable,
  text,
  timestamp,
  bigint,
  numeric,
  integer,
  serial,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Rol Tanımları
export const roleEnum = pgEnum('user_role', ['admin', 'agent', 'user']);
export const listingTypeEnum = pgEnum('listing_type', ['sale', 'rent']);

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
  titleTr: text('title_tr'),
  titleEn: text('title_en'),
  description: text('description'),
  descriptionTr: text('description_tr'),
  descriptionEn: text('description_en'),
  price: numeric('price').notNull(),
  currency: text('currency').default('TRY'),
  imageUrls: text('image_urls').array().default([]),
  specs: jsonb('specs').default({}),
  categoryId: bigint('category_id', { mode: 'number' }).references(
    () => categories.id,
  ),
  sellerId: integer('seller_id').references(() => users.id),

  // 🚀 TİCARET KOLONLARI
  type: listingTypeEnum('type').default('sale').notNull(), // Satılık mı Kiralık mı?
  isDaily: text('is_daily').default('false'), // Günlük kiralama aktif mi? (Airbnb modu)
  stock: integer('stock').default(1), // Amazon modu için stok takibi

  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 2. REZERVASYONLAR TABLOSU (Airbnb Modu İçin)
export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  listingId: bigint('listing_id', { mode: 'number' }).references(
    () => listings.id,
  ),
  customerId: integer('customer_id').references(() => users.id),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  totalPrice: numeric('total_price').notNull(),
  status: text('status').default('confirmed'), // confirmed, cancelled
  createdAt: timestamp('created_at').defaultNow(),
});

// 3. İLİŞKİLERİ GÜNCELLEYELİM
export const bookingsRelations = relations(bookings, ({ one }) => ({
  listing: one(listings, {
    fields: [bookings.listingId],
    references: [listings.id],
  }),
  customer: one(users, {
    fields: [bookings.customerId],
    references: [users.id],
  }),
}));

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

// backend/src/db/schema.ts en altına ekleyin:

export const banners = pgTable('banners', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  titleTr: text('title_tr').notNull(),
  titleEn: text('title_en').notNull(),
  subtitleTr: text('subtitle_tr'),
  subtitleEn: text('subtitle_en'),
  imageUrl: text('image_url').notNull(),
  link: text('link').default('/'), // Resme tıklayınca nereye gitsin?
  order: integer('order').default(0), // Sıralama için
  createdAt: timestamp('created_at').defaultNow(),
});

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
]);

// 🚀 2. SİPARİŞLER TABLOSU
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  listingId: bigint('listing_id', { mode: 'number' })
    .references(() => listings.id)
    .notNull(),
  buyerId: integer('buyer_id')
    .references(() => users.id)
    .notNull(), // Satın alan
  sellerId: integer('seller_id')
    .references(() => users.id)
    .notNull(), // Satan
  quantity: integer('quantity').default(1).notNull(),
  totalPrice: numeric('total_price').notNull(),
  status: orderStatusEnum('status').default('paid').notNull(), // Simülasyon olduğu için direkt 'paid' başlıyoruz
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 3. İLİŞKİLER
export const ordersRelations = relations(orders, ({ one }) => ({
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.id],
  }),
  buyer: one(users, { fields: [orders.buyerId], references: [users.id] }),
  seller: one(users, { fields: [orders.sellerId], references: [users.id] }),
}));
