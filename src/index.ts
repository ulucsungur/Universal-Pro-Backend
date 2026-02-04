import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { isNull, eq } from 'drizzle-orm';
import { db } from './db';
import { categories, listings, banners } from './db/schema';
import authRoutes from './routes/auth';
import { inArray } from 'drizzle-orm';
import { authenticate } from './middleware/auth';
import { and, gte, lte } from 'drizzle-orm';
import { bookings } from './db/schema';
import { orders } from './db/schema';
import { addresses } from './db/schema';
import { messages } from './db/schema';

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

// YENİ İLAN EKLEME (RESİMLERLE BİRLİKTE)
app.post(
  '/api/listings',
  authenticate,
  upload.array('images', 5),
  async (req: any, res) => {
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
      } = req.body;

      // 🚀 KRİTİK: Satıcı ID'sini artık güvenli olan 'req.user' içinden alıyoruz
      const sellerIdFromAuth = req.user.id;

      const files = req.files as Express.Multer.File[];
      const uploadedUrls: string[] = [];

      // A. Resim yükleme motoru (Supabase Storage)
      if (files) {
        for (const file of files) {
          const fileName = `list-${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
          const { error } = await supabaseAdmin.storage
            .from('listings')
            .upload(fileName, file.buffer);
          if (error) throw error;
          const {
            data: { publicUrl },
          } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);
          uploadedUrls.push(publicUrl);
        }
      }

      // B. Veritabanına mühürleme
      const [newListing] = await db
        .insert(listings)
        .values({
          title: titleTr || titleEn,
          titleTr,
          titleEn,
          description: descriptionTr || descriptionEn,
          descriptionTr,
          descriptionEn,
          price: price.toString(),
          currency: currency || 'TRY',
          imageUrls: uploadedUrls,
          categoryId: categoryId ? Number(categoryId) : null,
          specs: specs ? JSON.parse(specs) : {},
          sellerId: sellerIdFromAuth,

          type: req.body.type || 'sale',
          isDaily: req.body.isDaily || 'false',
          stock: req.body.stock ? Number(req.body.stock) : 1,
          isShippable: req.body.isShippable || 'true',
        })
        .returning();

      res.status(201).json(newListing);
    } catch (error: any) {
      console.error('Kayıt Hatası:', error.message);
      res.status(500).json({ error: error.message });
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
    const { listingId, quantity } = req.body;
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
        quantity: quantity || 1,
        totalPrice: (Number(listing.price) * (quantity || 1)).toString(),
        status: 'paid', // Simülasyon gereği ödeme yapıldı kabul ediyoruz
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
app.post('/api/messages', authenticate, async (req: any, res) => {
  try {
    const { listingId, receiverId, content } = req.body;
    const senderId = req.user.id;

    // 🚀 GÜVENLİK KİLİDİ: Kendine mesaj gönderimini engelle
    if (senderId === Number(receiverId)) {
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
    res.status(500).json({ error: error.message });
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

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend Sunucusu Hazır: http://localhost:${PORT}`);
});
