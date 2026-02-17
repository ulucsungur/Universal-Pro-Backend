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
  isShippable: text('is_shippable').default('true'), // 🚀 Araba/Ev için 'false

  // 🚀 TİCARET KOLONLARI
  type: listingTypeEnum('type').default('sale').notNull(), // Satılık mı Kiralık mı?
  isDaily: text('is_daily').default('false'), // Günlük kiralama aktif mi? (Airbnb modu)
  stock: integer('stock').default(1), // Amazon modu için stok takibi

  // 🚀 KONUM BİLGİLERİ
  latitude: numeric('latitude'), // Enlem (Örn: 41.0082)
  longitude: numeric('longitude'), // Boylam (Örn: 28.9784)
  country: text('country').default('Türkiye'),
  city: text('city'),
  district: text('district'),
  postCode: text('post_code'),
  addressText: text('address_text'), // Şehir/İlçe/Mahalle metni

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

// 🚀 1. DEĞERLENDİRMELER (REVIEWS) TABLOSU
export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id)
    .unique()
    .notNull(),
  listingId: bigint('listing_id', { mode: 'number' })
    .references(() => listings.id)
    .notNull(),
  buyerId: integer('buyer_id')
    .references(() => users.id)
    .notNull(),
  sellerId: integer('seller_id')
    .references(() => users.id)
    .notNull(),
  rating: integer('rating').notNull(), // 1 ile 5 arası
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow(),
});

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
  //status: orderStatusEnum('status').default('paid').notNull(), // Simülasyon olduğu için direkt 'paid' başlıyoruz.
  shippingStatus: text('shipping_status').default('preparing'), // preparing, shipped, delivered
  status: text('status').default('paid').notNull(), // paid, shipped, delivered, cancelled, returned

  // 🚀 PERFORMANS İÇİN ZAMAN DAMGALARI
  shippedAt: timestamp('shipped_at'), // Satıcının kargoladığı an
  deliveredAt: timestamp('delivered_at'), // Teslim edildiği an
  canceledAt: timestamp('canceled_at'), // İptal edildiği an
  canceledBy: text('canceled_by'), // 'seller' veya 'buyer'

  addressId: integer('address_id').references(() => addresses.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 3. İLİŞKİLERİ GÜNCELLE
export const reviewsRelations = relations(reviews, ({ one }) => ({
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
  listing: one(listings, {
    fields: [reviews.listingId],
    references: [listings.id],
  }),
  seller: one(users, { fields: [reviews.sellerId], references: [users.id] }),
}));

// 🚀 3. İLİŞKİLER
export const ordersRelations = relations(orders, ({ one }) => ({
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.id],
  }),
  buyer: one(users, { fields: [orders.buyerId], references: [users.id] }),
  seller: one(users, { fields: [orders.sellerId], references: [users.id] }),
  address: one(addresses, {
    fields: [orders.addressId],
    references: [addresses.id],
  }),
}));

// 🚀 1. ADRESLER TABLOSU
export const addresses = pgTable('addresses', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(), // Örn: Evim, İş Yerim
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  city: text('city').notNull(),
  district: text('district').notNull(),
  postCode: text('post_code'),
  addressDetail: text('address_detail').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 1. MESAJLAR TABLOSU
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  senderId: integer('sender_id')
    .references(() => users.id)
    .notNull(),
  receiverId: integer('receiver_id')
    .references(() => users.id)
    .notNull(),
  listingId: bigint('listing_id', { mode: 'number' })
    .references(() => listings.id)
    .notNull(),
  content: text('content').notNull(),
  isRead: text('is_read').default('false').notNull(), // Okundu bilgisi
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 2. MESAJ İLİŞKİLERİ
export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: 'sent_messages',
  }),
  receiver: one(users, {
    fields: [messages.receiverId],
    references: [users.id],
    relationName: 'received_messages',
  }),
  listing: one(listings, {
    fields: [messages.listingId],
    references: [listings.id],
  }),
}));

// 🚀 1. SEPET (CART) TABLOSU
export const cart = pgTable('cart', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  listingId: bigint('listing_id', { mode: 'number' })
    .references(() => listings.id)
    .notNull(),
  quantity: integer('quantity').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 2. FAVORİLER (FAVORITES) TABLOSU
export const favorites = pgTable('favorites', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  listingId: bigint('listing_id', { mode: 'number' })
    .references(() => listings.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 🚀 3. YENİ İLİŞKİLER (RELATIONS)
export const cartRelations = relations(cart, ({ one }) => ({
  user: one(users, { fields: [cart.userId], references: [users.id] }),
  listing: one(listings, {
    fields: [cart.listingId],
    references: [listings.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  listing: one(listings, {
    fields: [favorites.listingId],
    references: [listings.id],
  }),
}));

// backend/src/db/schema.ts içine ekle:

export const blogs = pgTable('blogs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(), // HTML (RichText) içeriği burada tutulacak
  imageUrl: text('image_url'),
  viewCount: integer('view_count').default(0),
  categoryId: bigint('category_id', { mode: 'number' }).references(
    () => categories.id,
  ),
  authorId: integer('author_id')
    .references(() => users.id)
    .notNull(),
  isPrivate: text('is_private').default('false').notNull(), // 'true' ise sadece admin/agent görebilir
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// İLİŞKİLER
export const blogsRelations = relations(blogs, ({ one }) => ({
  author: one(users, {
    fields: [blogs.authorId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [blogs.categoryId],
    references: [categories.id],
  }),
}));
