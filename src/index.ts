import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { db } from './db';
import { categories, listings } from './db/schema';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
); // Frontend izni
app.use(express.json());
app.use(cookieParser()); // Çerezleri okumak için şart

// Rotalar
app.use('/api/auth', authRoutes);

// 1. Tüm Kategorileri Getir
app.get('/api/categories', async (req, res) => {
  try {
    const data = await db.select().from(categories);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// 2. Tüm İlanları Getir
app.get('/api/listings', async (req, res) => {
  try {
    const data = await db.select().from(listings);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, () => {
  console.log('Backend Sunucusu Hazır: http://localhost:5000');
});
