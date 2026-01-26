import { Router } from 'express';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'gizli_anahtar_123';

// 1. KAYIT OL (Register)
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.insert(users).values({
      fullName,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'Kayıt başarılı!' });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: 'E-posta zaten kullanımda veya veritabanı hatası.' });
  }
});

// 2. GİRİŞ YAP (Login)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user || !(await bcrypt.hash(password, 10))) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    // Pasaportu (JWT) Hazırla
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    // Çerezi Tarayıcıya Mühürle (HttpOnly: JS erişemez, güvenlidir)
    res.cookie('universal_token', token, {
      httpOnly: true,
      secure: false, // Local'de çalıştığımız için false, yayında true olacak
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 gün
    });

    res.json({
      message: 'Giriş başarılı!',
      user: { id: user.id, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ error: 'Giriş yapılamadı.' });
  }
});

export default router;
