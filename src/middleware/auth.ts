import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET || 'google_senior_manager_secret_key_2026';

// 🚀 Güvenlik Görevlisi Fonksiyonu
export const authenticate = (req: any, res: Response, next: NextFunction) => {
  // 1. Çerezlerden 'universal_session' token'ını al
  const token = req.cookies.universal_session;

  if (!token) {
    return res
      .status(401)
      .json({ error: 'İlan vermek için giriş yapmalısınız.' });
  }

  try {
    // 2. Token'ın doğruluğunu kontrol et
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    // 3. Kullanıcı bilgisini isteğe (request) ekle ki route içinde kullanabilelim
    req.user = decoded;

    // 4. Onay verildi, sıradaki işleme (ilan kaydına) geç
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: 'Oturum süreniz dolmuş, lütfen tekrar giriş yapın.' });
  }
};
