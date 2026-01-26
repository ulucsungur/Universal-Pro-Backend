import { Router, Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();
const JWT_SECRET =
  process.env.JWT_SECRET || 'google_senior_manager_secret_key_2026';

// --- YARDIMCI: JWT VE ÇEREZ OLUŞTURUCU (Tüm girişlerde bu çalışır) ---
const generateSession = (res: Response, user: any) => {
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });

  res.cookie('universal_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// 1. EMAIL/PASSWORD KAYIT
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { fullName, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await db
      .insert(users)
      .values({ fullName, email, password: hashedPassword, role: 'user' });
    res.status(201).json({ message: 'Kayıt başarılı!' });
  } catch (error) {
    res.status(500).json({ error: 'E-posta kullanımda veya sunucu hatası.' });
  }
});

// 2. EMAIL/PASSWORD GİRİŞ
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }
    generateSession(res, user);
    res.json({
      user: { id: user.id, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ error: 'Giriş başarısız.' });
  }
});

// 3. GITHUB OAUTH (GİDİŞ VE DÖNÜŞ)
router.get('/github', (req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=http://localhost:5000/api/auth/github/callback&scope=user:email`;
  res.redirect(url);
});

router.get('/github/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: 'application/json' } },
    );

    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${tokenRes.data.access_token}` },
    });

    let user = await db.query.users.findFirst({
      where: eq(users.githubId, userRes.data.id.toString()),
    });
    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          fullName: userRes.data.name || userRes.data.login,
          email: userRes.data.email || `${userRes.data.login}@github.com`,
          githubId: userRes.data.id.toString(),
          avatarUrl: userRes.data.avatar_url,
          role: 'user',
        })
        .returning();
    }
    generateSession(res, user);
    res.redirect('http://localhost:5173');
  } catch (error) {
    res.redirect('http://localhost:5173/login?error=auth_failed');
  }
});

// 4. GOOGLE OAUTH (GİDİŞ VE DÖNÜŞ)
router.get('/google', (req, res) => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=http://localhost:5000/api/auth/google/callback&response_type=code&scope=profile email`;
  res.redirect(url);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:5000/api/auth/google/callback',
    });

    const userRes = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
      },
    );

    let user = await db.query.users.findFirst({
      where: eq(users.googleId, userRes.data.id),
    });
    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          fullName: userRes.data.name,
          email: userRes.data.email,
          googleId: userRes.data.id,
          avatarUrl: userRes.data.picture,
          role: 'user',
        })
        .returning();
    }
    generateSession(res, user);
    res.redirect('http://localhost:5173');
  } catch (error) {
    res.redirect('http://localhost:5173/login?error=auth_failed');
  }
});

// 5. ME & LOGOUT
router.get('/me', async (req: Request, res: Response) => {
  const token = req.cookies.universal_session;
  if (!token) return res.status(401).json({ user: null });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await db.query.users.findFirst({
      where: eq(users.id, decoded.id),
    });
    res.json(user);
  } catch {
    res.status(401).json({ user: null });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('universal_session');
  res.json({ message: 'Çıkış başarılı.' });
});

export default router;
