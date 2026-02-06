import { isNull, eq, inArray, and, desc, gte, lte } from 'drizzle-orm';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';
import { categories, listings, banners, reviews, users } from './db/schema';
import authRoutes from './routes/auth';
import { authenticate } from './middleware/auth';
import { bookings } from './db/schema';
import { orders } from './db/schema';
import { addresses } from './db/schema';
import { messages } from './db/schema';
import axios from 'axios';
import { InferSelectModel } from 'drizzle-orm';
import adminRoutes from './routes/admin';

dotenv.config();

const app = express();

// 1. GÜVENLİK AYARLARI
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// 2. SUPABASE ADMIN (STORAGE İÇİN)
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Eğer değişkenler eksikse sunucu başlamadan bizi terminalde uyarsın
if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '❌ HATA: SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY bulunamadı!',
  );
  console.log('Mevcut URL:', supabaseUrl);
  process.exit(1); // Sunucuyu durdur ki hatayı görebilelim
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
// 3. DOSYA YÜKLEME AYARI
const upload = multer({ storage: multer.memoryStorage() });

// 4. ROTALAR (ROUTES)
app.use('/api/auth', authRoutes);

// KATEGORİLER
// Bu fonksiyon bir ağaç gibi aşağı doğru tüm ID'leri toplar
async function getAllCategoryIds(parentId: number): Promise<number[]> {
  const subCats = await db
    .select()
    .from(categories)
    .where(eq(categories.parentId, parentId));
  let ids = [parentId];
  for (const sub of subCats) {
    const subIds = await getAllCategoryIds(sub.id);
    ids = [...ids, ...subIds];
  }
  return ids;
}
app.get('/api/categories', async (req, res) => {
  try {
    const topOnly = req.query.topOnly === 'true';
    const data = topOnly
      ? await db.select().from(categories).where(isNull(categories.parentId))
      : await db.select().from(categories);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bir kategoriye tıklandığında (Vasıta gibi) tüm alt ilanları getiren kapı
app.get('/api/category/:slug/listings', async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Önce kategoriyi bul
    const category = await db.query.categories.findFirst({
      where: eq(categories.slug, slug),
    });

    if (!category)
      return res.status(404).json({ error: 'Kategori bulunamadı' });

    // 2. Alt kategori ID'lerini topla (Recursive fonksiyonunuz çalışıyor olmalı)
    const allIds = await getAllCategoryIds(category.id);

    // 3. 🚀 KESİN ÇÖZÜM: İlişkisel sorgu ile ilanları ve satıcıları çek
    // 'sellerId' NULL olsa bile bu sorgu ilanları getirecektir.
    const data = await db.query.listings.findMany({
      where: inArray(listings.categoryId, allIds),
      with: {
        seller: true, // Satıcı varsa getirir, yoksa 'null' döner
      },
    });

    res.json({
      category,
      listings: data,
    });
  } catch (error: any) {
    console.error('Kategori API Hatası:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// İLANLARI LİSTELE
app.get('/api/listings', async (req, res) => {
  try {
    const data = await db.select().from(listings);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// TEKİL İLAN DETAYI
app.get('/api/listings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 🚀 JOIN İşlemi: İlanı çek, yanına satıcıyı (users) ve kategoriyi de ekle
    const data = await db.query.listings.findFirst({
      where: eq(listings.id, Number(id)),
      with: {
        seller: true, // listings.sellerId -> users.id eşleşmesi
        category: true, // listings.categoryId -> categories.id eşleşmesi
      },
    });

    if (!data) return res.status(404).json({ error: 'İlan bulunamadı' });
    res.json(data);
  } catch (error: any) {
    console.error('Detay API Hatası:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🚀 İLAN DÜZENLEME MOTORU (PATCH) - KESİN KONUMLANDIRMA
app.patch(
  '/api/listings/:id',
  authenticate,
  upload.array('images', 5),
  async (req: any, res: any) => {
    const { id } = req.params;

    // 🔍 TEŞHİS: Terminalde bu yazıyı görmeniz lazım
    console.log(`📡 BACKEND: ID ${id} için PATCH isteği ulaştı.`);

    try {
      // 1. İlanı bul
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, Number(id)),
      });

      if (!listing)
        return res.status(404).json({ error: 'İlan veritabanında yok.' });

      // 2. Sahibi mi kontrol et
      if (listing.sellerId !== req.user.id) {
        return res.status(403).json({ error: 'Yetkisiz erişim.' });
      }

      const {
        titleTr,
        titleEn,
        descriptionTr,
        descriptionEn,
        price,
        currency,
        categoryId,
        specs,
        isShippable,
        latitude,
        longitude,
        addressText,
        postCode,
      } = req.body;

      // 3. Resim mühürleme
      let uploadedUrls = listing.imageUrls || [];
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        for (const file of files) {
          const fileName = `edit-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from('listings')
            .upload(fileName, file.buffer, { contentType: file.mimetype });

          if (!uploadError) {
            const {
              data: { publicUrl },
            } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);
            uploadedUrls.push(publicUrl);
          }
        }
      }

      // 4. Veritabanını Güncelle
      const [updated] = await db
        .update(listings)
        .set({
          title: titleTr || titleEn || listing.title,
          titleTr: titleTr || listing.titleTr,
          titleEn: titleEn || listing.titleEn,
          description: descriptionTr || descriptionEn || listing.description,
          descriptionTr: descriptionTr || listing.descriptionTr,
          descriptionEn: descriptionEn || listing.descriptionEn,
          price: price ? price.toString() : listing.price,
          currency: currency || listing.currency,
          categoryId: categoryId ? Number(categoryId) : listing.categoryId,
          specs: specs
            ? typeof specs === 'string'
              ? JSON.parse(specs)
              : specs
            : listing.specs,
          isShippable: isShippable || listing.isShippable,
          latitude: latitude || listing.latitude,
          longitude: longitude || listing.longitude,
          addressText: addressText || listing.addressText,
          postCode: postCode || listing.postCode,
          imageUrls: uploadedUrls,
        })
        .where(eq(listings.id, Number(id)))
        .returning();

      console.log('✅ Başarıyla güncellendi.');
      res.json(updated);
    } catch (error: any) {
      console.error('❌ PATCH HATASI:', error.message);
      res.status(500).json({ error: error.message });
    }
  },
);

// 🚀 1. GEOCONDING PROXY (CORS & 403 BYPASS)
app.get('/api/geocoding', async (req, res) => {
  const { q } = req.query;
  if (!q)
    return res.status(400).json({ error: 'Sorgu parametresi (q) gerekli.' });

  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search`,
      {
        params: {
          q: q,
          format: 'json',
          limit: 1,
          addressdetails: 1,
        },
        headers: {
          // 🚀 Nominatim bu başlığı görmezse 403 verir. Biz burada uçağın kimliğini bildiriyoruz.
          'User-Agent': 'UniversalMarketPro/1.0 (iletisim@unimarketpro.com)',
        },
      },
    );
    res.json(response.data);
  } catch (error: any) {
    console.error('Geocoding Hatası:', error.message);
    res.status(500).json({ error: 'Konum verisi sunucudan alınamadı.' });
  }
});

// YENİ İLAN EKLEME (RESİMLERLE BİRLİKTE)
app.post(
  '/api/listings',
  authenticate,
  upload.array('images', 5),
  async (req: any, res: any) => {
    try {
      const {
        titleTr,
        titleEn,
        descriptionTr,
        descriptionEn,
        price,
        currency,
        categoryId,
        specs,
        latitude,
        longitude,
        addressText,
      } = req.body;

      const sellerIdFromAuth = req.user.id;
      const files = req.files as Express.Multer.File[];
      const uploadedUrls: string[] = [];

      // A. Resimleri Supabase Storage'a Yükle
      if (files && files.length > 0) {
        for (const file of files) {
          // Dosya isminden Türkçe karakterleri ve boşlukları temizle
          const fileName = `list-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const { error } = await supabaseAdmin.storage
            .from('listings')
            .upload(fileName, file.buffer, {
              contentType: file.mimetype,
              upsert: false,
            });

          if (error) throw error;

          const {
            data: { publicUrl },
          } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);

          uploadedUrls.push(publicUrl);
        }
      }

      // B. Specs JSON Güvenliği
      let parsedSpecs = {};
      try {
        parsedSpecs =
          typeof specs === 'string' ? JSON.parse(specs) : specs || {};
      } catch (e) {
        console.warn('Specs JSON parse hatası:', e);
      }

      // C. Veritabanı Mühürleme
      const [newListing] = await db
        .insert(listings)
        .values({
          title: titleTr || titleEn,
          titleTr,
          titleEn,
          description: descriptionTr || descriptionEn,
          descriptionTr,
          descriptionEn,
          price: price ? price.toString() : '0',
          currency: currency || 'TRY',
          imageUrls: uploadedUrls,
          categoryId: categoryId ? Number(categoryId) : null,
          specs: parsedSpecs,
          sellerId: sellerIdFromAuth,
          type: req.body.type || 'sale',
          isDaily: req.body.isDaily === 'true' ? 'true' : 'false',
          stock: req.body.stock ? Number(req.body.stock) : 1,
          isShippable: req.body.isShippable === 'false' ? 'false' : 'true',
          // 🚀 Koordinatları güvenli bir şekilde Number'a çeviriyoruz
          latitude: latitude ? latitude.toString() : null,
          longitude: longitude ? longitude.toString() : null,
          addressText: addressText || null,
        })
        .returning();

      res.status(201).json(newListing);
    } catch (error: any) {
      console.error('Kayıt Hatası:', error);
      res.status(500).json({ error: 'İlan kaydedilirken bir hata oluştu.' });
    }
  },
);

// 1. YENİ KATEGORİ EKLEME (Resimli & Çok Dilli)
app.post('/api/categories', upload.single('image'), async (req: any, res) => {
  try {
    const { titleTr, titleEn, slug, parentId } = req.body;
    let imageUrl = '';

    // Eğer resim seçildiyse Supabase Storage'a yükle
    if (req.file) {
      const fileName = `cat-${Date.now()}-${req.file.originalname}`;
      const { data, error: uploadError } = await supabaseAdmin.storage
        .from('listings') // Kategoriler için de aynı bucket'ı kullanabiliriz
        .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);
      imageUrl = publicUrl;
    }

    const [newCategory] = await db
      .insert(categories)
      .values({
        titleTr,
        titleEn,
        slug,
        imageUrl,
        parentId: parentId ? Number(parentId) : null,
      })
      .returning();

    res.status(201).json(newCategory);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/banners', async (req, res) => {
  try {
    const data = await db.query.banners.findMany({
      orderBy: (banners, { asc }) => [asc(banners.order)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 BANNER EKLEME (Garantili ve Hatasız Versiyon)
app.post('/api/banners', upload.single('image'), async (req: any, res: any) => {
  try {
    const { titleTr, titleEn, subtitleTr, subtitleEn, link, order } = req.body;
    let imageUrl = '';

    if (req.file) {
      const fileName = `banner-${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('banners')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabaseAdmin.storage.from('banners').getPublicUrl(fileName);

      imageUrl = publicUrl;
    }

    // Banner Resim  Yükleme API'si
    const [newBanner] = await db
      .insert(banners)
      .values({
        titleTr,
        titleEn,
        subtitleTr: subtitleTr || '',
        subtitleEn: subtitleEn || '',
        imageUrl,
        link: link || '/',
        order: order ? Number(order) : 0,
      })
      .returning();

    res.status(201).json(newBanner);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Bilinmeyen hata';
    console.error('Banner Hatası:', msg);
    res.status(500).json({ error: msg });
  }
});

// 🚀 BİR İLANIN DOLU TARİHLERİNİ GETİR
app.get('/api/listings/:id/booked-dates', async (req, res) => {
  const { id } = req.params;
  try {
    const data = await db
      .select({
        startDate: bookings.startDate,
        endDate: bookings.endDate,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.listingId, Number(id)),
          eq(bookings.status, 'confirmed'),
        ),
      );

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 SATIN ALMA İŞLEMİ (Amazon Modu)
app.post('/api/orders', authenticate, async (req: any, res) => {
  try {
    const { listingId, addressId, quantity, totalPrice } = req.body;
    const buyerId = req.user.id;

    // 1. İlan bilgilerini al (Fiyat ve Satıcıyı bulmak için)
    const listing = await db.query.listings.findFirst({
      where: eq(listings.id, Number(listingId)),
    });

    if (!listing) return res.status(404).json({ error: 'İlan bulunamadı' });

    // 2. Siparişi oluştur
    const [newOrder] = await db
      .insert(orders)
      .values({
        listingId: Number(listingId),
        buyerId: buyerId,
        sellerId: listing.sellerId as number,
        addressId: addressId ? Number(addressId) : null,
        quantity: quantity || 1,
        totalPrice: (Number(listing.price) * (quantity || 1)).toString(),
        status: 'paid', // Simülasyon gereği ödeme yapıldı kabul ediyoruz
        shippingStatus: 'preparing',
      })
      .returning();

    res.status(201).json(newOrder);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 SİPARİŞLERİM LİSTESİ (Alıcı için)
app.get('/api/orders/my-orders', authenticate, async (req: any, res) => {
  try {
    const data = await db.query.orders.findMany({
      where: eq(orders.buyerId, req.user.id),
      with: {
        listing: true, // Ürün bilgisini de getir
        address: true,
        seller: true, // Satıcı bilgisini de getir
      },
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// 1. KULLANICININ ADRESLERİNİ GETİR
app.get('/api/addresses', authenticate, async (req: any, res) => {
  try {
    const data = await db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, req.user.id));
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. YENİ ADRES EKLE
app.post('/api/addresses', authenticate, async (req: any, res) => {
  try {
    const { title, fullName, phone, city, district, addressDetail } = req.body;
    const [newAddress] = await db
      .insert(addresses)
      .values({
        userId: req.user.id,
        title,
        fullName,
        phone,
        city,
        district,
        addressDetail,
      })
      .returning();
    res.status(201).json(newAddress);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 1. SATICIYA GELEN SİPARİŞLERİ GETİR (Sales)
app.get('/api/orders/my-sales', authenticate, async (req: any, res) => {
  try {
    const data = await db.query.orders.findMany({
      where: eq(orders.sellerId, req.user.id),
      with: {
        buyer: true,
        address: true, // 🚀 Sipariş adresini çek
        listing: {
          with: {
            category: true, // 🚀 İlanın içindeki kategoriyi de çek (Nested)
          },
        },
      },
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. SİPARİŞ DURUMUNU GÜNCELLE (Kargola / Teslim Et)
app.patch('/api/orders/:id/status', authenticate, async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'shipped' veya 'delivered' gelecek

  try {
    const [updatedOrder] = await db
      .update(orders)
      .set({ shippingStatus: status })
      .where(
        and(
          eq(orders.id, Number(id)),
          eq(orders.sellerId, req.user.id), // 🚀 Sadece satıcı güncelleyebilir
        ),
      )
      .returning();

    if (!updatedOrder)
      return res
        .status(404)
        .json({ error: 'Sipariş bulunamadı veya yetkiniz yok.' });
    res.json(updatedOrder);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 1. MESAJ GÖNDER
app.post('/api/messages', authenticate, async (req: any, res: any) => {
  try {
    const { listingId, receiverId, content } = req.body;
    const senderId = req.user.id;

    // 🚀 TEŞHİS LOGU: Terminale bakın
    console.log(
      `📩 Mesaj İsteği -> Gönderen: ${senderId}, Alıcı: ${receiverId}`,
    );

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Mesaj içeriği boş olamaz.' });
    }

    // 🚀 GÜVENLİK KONTROLÜ: Alıcı ile Gönderen aynı mı?
    if (Number(senderId) === Number(receiverId)) {
      return res
        .status(400)
        .json({ error: 'Kendi ilanınıza mesaj gönderemezsiniz.' });
    }

    const [newMessage] = await db
      .insert(messages)
      .values({
        senderId,
        receiverId: Number(receiverId),
        listingId: Number(listingId),
        content,
      })
      .returning();

    res.status(201).json(newMessage);
  } catch (error: any) {
    console.error('❌ Mesaj Hatası:', error.message);
    res.status(500).json({ error: 'Sunucu hatası oluştu.' });
  }
});

// 2. GELEN KUTUSUNU LİSTELE
app.get('/api/messages/inbox', authenticate, async (req: any, res) => {
  try {
    const data = await db.query.messages.findMany({
      where: eq(messages.receiverId, req.user.id),
      with: {
        sender: true,
        listing: true,
      },
      orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GİDEN KUTUSUNU LİSTELE (Sent Messages)
app.get('/api/messages/sent', authenticate, async (req: any, res) => {
  try {
    const data = await db.query.messages.findMany({
      where: eq(messages.senderId, req.user.id),
      with: {
        receiver: true, // 🚀 Kime gönderdim?
        listing: true,
      },
      orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. OKUNMAMIŞ MESAJ SAYISI (Bildirim Rozeti İçin)
app.get('/api/messages/unread-count', authenticate, async (req: any, res) => {
  try {
    const data = await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.receiverId, req.user.id), eq(messages.isRead, 'false')),
      );
    res.json({ count: data.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// 🚀 MESAJI OKUNDU OLARAK İŞARETLE
app.patch('/api/messages/:id/read', authenticate, async (req: any, res) => {
  const { id } = req.params;
  try {
    await db
      .update(messages)
      .set({ isRead: 'true' })
      .where(
        and(
          eq(messages.id, Number(id)),
          eq(messages.receiverId, req.user.id), // 🚀 Sadece alıcı okundu yapabilir
        ),
      );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookings', authenticate, async (req: any, res: any) => {
  try {
    const { listingId, startDate, endDate, totalPrice } = req.body;

    const [newBooking] = await db
      .insert(bookings)
      .values({
        listingId: Number(listingId),
        customerId: req.user.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalPrice: totalPrice.toString(),
        status: 'confirmed',
      })
      .returning();

    res.status(201).json(newBooking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 KULLANICININ REZERVASYONLARINI GETİR (Trips/Bookings)
app.get('/api/bookings/my-bookings', authenticate, async (req: any, res) => {
  try {
    const data = await db.query.bookings.findMany({
      where: eq(bookings.customerId, req.user.id),
      with: {
        listing: true, // Kiralanan ürün bilgisi
      },
      orderBy: (bookings, { desc }) => [desc(bookings.createdAt)],
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }

  // 🚀 İLAN GÜNCELLEME (Sadece Sahibi Yapabilir)
  app.patch(
    '/api/listings/:id',
    authenticate,
    upload.array('images', 5),
    async (req: any, res: any) => {
      const { id } = req.params;

      // Terminalde bu yazıyı görmeliyiz
      console.log(
        `🛠 Düzenleme Talebi -> ID: ${id} | Kullanıcı: ${req.user.id}`,
      );

      try {
        // 1. İlanı bul
        const listing = await db.query.listings.findFirst({
          where: eq(listings.id, Number(id)),
        });

        if (!listing)
          return res.status(404).json({ error: 'İlan bulunamadı.' });

        // 2. Güvenlik Kontrolü
        if (listing.sellerId !== req.user.id) {
          return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
        }

        const {
          titleTr,
          titleEn,
          descriptionTr,
          descriptionEn,
          price,
          currency,
          categoryId,
          specs,
          isShippable,
          latitude,
          longitude,
          addressText,
          postCode,
          city,
          district,
        } = req.body;

        // 3. Resim Yönetimi
        let uploadedUrls = listing.imageUrls || [];
        const files = req.files as Express.Multer.File[];

        if (files && files.length > 0) {
          for (const file of files) {
            const fileName = `edit-${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
            const { error: uploadError } = await supabaseAdmin.storage
              .from('listings')
              .upload(fileName, file.buffer, { contentType: file.mimetype });

            if (!uploadError) {
              const {
                data: { publicUrl },
              } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);
              uploadedUrls.push(publicUrl);
            }
          }
        }

        // 5. Veritabanını Güncelle
        const [updated] = await db
          .update(listings)
          .set({
            title: titleTr || titleEn || listing.title,
            titleTr: titleTr || listing.titleTr,
            titleEn: titleEn || listing.titleEn,
            description: descriptionTr || descriptionEn || listing.description,
            descriptionTr: descriptionTr || listing.descriptionTr,
            descriptionEn: descriptionEn || listing.descriptionEn,
            price: price ? price.toString() : listing.price,
            currency: currency || listing.currency,
            categoryId: categoryId ? Number(categoryId) : listing.categoryId,
            // Specs verisi metin olarak gelirse parse et, yoksa mevcut olanı tut
            specs: specs ? JSON.parse(specs) : listing.specs,
            isShippable: isShippable || listing.isShippable,
            latitude: latitude || listing.latitude,
            longitude: longitude || listing.longitude,
            addressText: addressText || listing.addressText,
            postCode: postCode || listing.postCode,
            imageUrls: uploadedUrls,
          })
          .where(eq(listings.id, Number(id)))
          .returning();

        console.log('✅ Güncelleme Başarıyla Mühürlendi!');
        res.json(updated);
      } catch (error: any) {
        console.error('❌ PATCH API ERROR:', error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );
});

// 1. SİPARİŞ İPTALİ (Stok Geri Kazanma ve İade Simülasyonu)
app.patch(
  '/api/orders/:id/cancel',
  authenticate,
  async (req: any, res: any) => {
    const { id } = req.params;
    const { reason } = req.body; // 'buyer' veya 'seller'

    try {
      const order = await db.query.orders.findFirst({
        where: eq(orders.id, Number(id)),
        with: { listing: true },
      });

      if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

      // 🚀 STOK GERİ KAZANIMI: Ürün stoğunu iade et
      await db
        .update(listings)
        .set({ stock: (order.listing?.stock || 0) + order.quantity })
        .where(eq(listings.id, order.listingId));

      // 🚀 2. ÇİFT DURUM GÜNCELLEME (Hem sipariş hem kargo durumu iptal olmalı)
      const [updated] = await db
        .update(orders)
        .set({
          status: 'cancelled',
          shippingStatus: 'cancelled', // 🚀 SATIŞLARIM sayfası artık bunu görecek
          canceledAt: new Date(),
          canceledBy: reason,
        })
        .where(eq(orders.id, Number(id)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// 2. YILDIZLI PUANLAMA (Review System)
app.post('/api/reviews', authenticate, async (req: any, res: any) => {
  try {
    const { orderId, rating, comment } = req.body;
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });

    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

    const [newReview] = await db
      .insert(reviews)
      .values({
        orderId,
        listingId: order.listingId,
        buyerId: req.user.id,
        sellerId: order.sellerId,
        rating,
        comment,
      })
      .returning();

    res.status(201).json(newReview);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 1. YARDIMCI FONKSİYON: GPS SKORU HESAPLAMA (Google/Amazon Standardı)
type Order = InferSelectModel<typeof orders> & { listing?: any };

const calculateGPS = (ordersData: Order[]) => {
  const total = ordersData.length || 1;

  // Hata Adetleri
  const defective = ordersData.filter((o) => o.status === 'returned').length;
  const cancelledBySeller = ordersData.filter(
    (o) => o.status === 'cancelled' && o.canceledBy === 'seller',
  ).length;
  const lateShipments = ordersData.filter((o) => {
    if (!o.shippedAt || !o.createdAt) return false;
    const diff =
      new Date(o.shippedAt).getTime() - new Date(o.createdAt).getTime();
    return diff > 3 * 24 * 60 * 60 * 1000;
  }).length;

  // Başarı Puanları (S = 100 - Hata Oranı)
  const S_ODR = 100 - (defective / total) * 100;
  const S_LSR = 100 - (lateShipments / total) * 100;
  const S_CR = 100 - (cancelledBySeller / total) * 100;
  const S_RR = 98; // Varsayılan başarı

  // Ağırlıklı Ortalama
  const gps = S_ODR * 0.4 + S_LSR * 0.2 + S_CR * 0.25 + S_RR * 0.15;

  return {
    gps: Number(gps.toFixed(2)),
    metrics: {
      odr: { count: defective, score: S_ODR },
      lsr: { count: lateShipments, score: S_LSR },
      cr: { count: cancelledBySeller, score: S_CR },
    },
  };
};

// 🚀 2. API ROTASI: SATICI PERFORMANSI
app.get('/api/stats/performance', authenticate, async (req: any, res) => {
  try {
    const isSeller = req.query.sellerId;
    const targetId = isSeller ? Number(isSeller) : req.user.id;

    // Sadece bu satıcıya ait siparişleri çek (Son 30 gün)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const data = await db.query.orders.findMany({
      where: and(
        eq(orders.sellerId, targetId),
        gte(orders.createdAt, thirtyDaysAgo),
      ),
    });

    const performance = calculateGPS(data);
    res.json({
      totalOrders: data.length,
      ...performance,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// backend/src/index.ts içindeki admin rotaları
app.use('/api/admin', adminRoutes);

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend Sunucusu Hazır: http://localhost:${PORT}`);
});
