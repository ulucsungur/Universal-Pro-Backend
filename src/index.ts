import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { isNull, eq } from 'drizzle-orm';
import { db } from './db';
import { categories, listings } from './db/schema';
import authRoutes from './routes/auth';
import { inArray } from 'drizzle-orm';

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
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug));
    if (!category)
      return res.status(404).json({ error: 'Kategori bulunamadı' });

    const allIds = await getAllCategoryIds(category.id); // 🚀 Dedektif çalıştı!
    const data = await db
      .select()
      .from(listings)
      .where(inArray(listings.categoryId, allIds));

    res.json({ category, listings: data });
  } catch (error: any) {
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
    const data = await db
      .select()
      .from(listings)
      .where(eq(listings.id, Number(id)));
    if (data.length === 0)
      return res.status(404).json({ error: 'İlan bulunamadı' });
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// YENİ İLAN EKLEME (RESİMLERLE BİRLİKTE)
app.post('/api/listings', upload.array('images', 5), async (req: any, res) => {
  try {
    const { title, description, price, currency } = req.body;
    const files = req.files as Express.Multer.File[];
    const uploadedUrls: string[] = [];

    if (files) {
      for (const file of files) {
        const fileName = `${Date.now()}-${file.originalname}`;
        const { data, error } = await supabaseAdmin.storage
          .from('listings')
          .upload(fileName, file.buffer, { contentType: file.mimetype });

        if (error) throw error;

        const {
          data: { publicUrl },
        } = supabaseAdmin.storage.from('listings').getPublicUrl(fileName);
        uploadedUrls.push(publicUrl);
      }
    }

    const [newListing] = await db
      .insert(listings)
      .values({
        title,
        description,
        price: price.toString(),
        currency: currency || 'TRY',
        imageUrls: uploadedUrls,
      })
      .returning();

    res.status(201).json(newListing);
  } catch (error: any) {
    console.error('Yükleme Hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

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

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend Sunucusu Hazır: http://localhost:${PORT}`);
});
