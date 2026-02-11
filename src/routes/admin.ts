import { Router } from 'express';
import { db } from '../db';
import { users, listings, orders } from '../db/schema';
import { ne, eq, desc, and } from 'drizzle-orm';
import { authenticate } from '../middleware/auth';
import { calculateGPS } from '../lib/analytics';

const router = Router();

// 🚀 1. KÜRESEL İSTATİSTİKLER (FinanceView için)
// URL: /api/admin/stats
// backend/src/routes/admin.ts içindeki ilgili bölüm
router.get('/stats', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });

  try {
    const allUsers = await db.select().from(users);
    const allListings = await db.select().from(listings);
    const allOrders = await db.query.orders.findMany({
      with: { listing: { with: { category: true } } },
    });

    const totalRevenue = allOrders
      .filter((o) => o.status !== 'cancelled')
      .reduce((acc, o) => acc + Number(o.totalPrice || 0), 0);

    const totalOrdersCount = allOrders.length || 1;
    // 🚀 SAĞLIK SKORU HESABI
    const cancelledBySeller = allOrders.filter(
      (o) => o.status === 'cancelled' && o.canceledBy === 'seller',
    ).length;
    const returnedCount = allOrders.filter(
      (o) => o.status === 'returned',
    ).length;
    const totalFaults = cancelledBySeller + returnedCount;
    const odrRate = (totalFaults / totalOrdersCount) * 100;
    const healthScore = 100 - odrRate; // 🚀 Bu değer 'score' olarak gidecek

    const monthlyMap = new Map();
    allOrders
      .filter((o) => o.status !== 'cancelled')
      .forEach((o) => {
        const date = new Date(o.createdAt!);
        const monthKey = date.toLocaleString('en-US', { month: 'short' });
        const catName = o.listing?.category?.titleTr || 'Diğer';

        if (!monthlyMap.has(monthKey))
          monthlyMap.set(monthKey, { name: monthKey });
        const monthObj = monthlyMap.get(monthKey);
        monthObj[catName] =
          (monthObj[catName] || 0) + Number(o.totalPrice || 0);
      });

    res.json({
      totalUsers: allUsers.length,
      totalListings: allListings.length,
      totalRevenue,
      health: {
        odr: odrRate.toFixed(2),
        score: healthScore.toFixed(2), // 🚀 Bu değer artık kesinlikle gidiyor
        status: odrRate < 1 ? 'Healthy' : 'At Risk',
      },
      financeData: Array.from(monthlyMap.values()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
// 🚀 2. ACENTE PERFORMANS LİSTESİ (AgentsView için)
// URL: /api/admin/agents-performance (Frontend bu adresi arıyor)
router.get('/agents-performance', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });

  try {
    const agents = await db.query.users.findMany({
      where: eq(users.role, 'agent'),
    });

    const performanceList = await Promise.all(
      agents.map(async (agent) => {
        const agentOrders = await db.query.orders.findMany({
          where: eq(orders.sellerId, agent.id),
        });

        const perf = calculateGPS(agentOrders);
        const revenue = agentOrders
          .filter((o: any) => o.status !== 'cancelled')
          .reduce((acc: number, o: any) => acc + Number(o.totalPrice || 0), 0);

        return {
          agent,
          ...perf,
          totalRevenue: revenue,
        };
      }),
    );

    res.json(performanceList);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 3. TÜM KULLANICILARI LİSTELE (RBACView için)
// URL: /api/admin/users
router.get('/users', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });
  try {
    const data = await db.select().from(users).orderBy(desc(users.createdAt));
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 4. KULLANICI ROLÜNÜ GÜNCELLE
// URL: /api/admin/users/:id/role
router.patch('/users/:id/role', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });

  const { role } = req.body;
  try {
    await db
      .update(users)
      .set({ role })
      .where(eq(users.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 6. KİRALAMA ANALİZİ (Günlük vs Uzun Dönem)
router.get('/rental-analysis', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });
  try {
    const rentalListings = await db.query.listings.findMany({
      where: eq(listings.type, 'rent'),
    });

    const daily = rentalListings.filter((l) => l.isDaily === 'true').length;
    const longTerm = rentalListings.filter((l) => l.isDaily === 'false').length;

    res.json([
      { name: 'Günlük Kiralama', value: daily, color: '#a855f7' },
      { name: 'Uzun Dönem', value: longTerm, color: '#3b82f6' },
    ]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🚀 ACENTE MESAİSİ (Aylık İlan Yükleme Trendi)
router.get('/workload', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });
  try {
    const allListings = await db.query.listings.findMany({
      with: { seller: true },
    });

    const monthsOrder = [
      'Oca',
      'Şub',
      'Mar',
      'Nis',
      'May',
      'Haz',
      'Tem',
      'Ağu',
      'Eyl',
      'Eki',
      'Kas',
      'Ara',
    ];
    const groupedData: Record<string, any> = {};

    allListings.forEach((l) => {
      if (!l.createdAt || !l.seller) return;
      const date = new Date(l.createdAt);
      const monthLabel = monthsOrder[date.getMonth()];
      const agentName = l.seller.fullName;

      if (!groupedData[monthLabel]) {
        groupedData[monthLabel] = {
          month: monthLabel,
          _sortIdx: date.getMonth(),
        };
      }
      groupedData[monthLabel][agentName] =
        (groupedData[monthLabel][agentName] || 0) + 1;
    });

    const result = Object.values(groupedData).sort(
      (a: any, b: any) => a._sortIdx - b._sortIdx,
    );
    result.forEach((item: any) => delete item._sortIdx);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// test acenta mesaisi
router.get('/workload', authenticate, async (req: any, res: any) => {
  // 🚀 ASİT TESTİ: Eğer grafik hala değişmezse, backend bu kodu görmüyor demektir!
  const testVerisi = [
    { month: 'Oca', 'Uluç Sungur': 4, 'Tuna Sungur': 0 },
    { month: 'Şub', 'Uluç Sungur': 2, 'Tuna Sungur': 2 },
  ];
  console.log('!!! TEST VERİSİ GÖNDERİLİYOR !!!');
  res.json(testVerisi);
});

// 🚀 KİRALAMA ANALİZİ (Günlük vs Uzun Dönem)
router.get('/rental-analysis', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Yetkisiz' });
  try {
    const rentals = await db.query.listings.findMany({
      where: eq(listings.type, 'rent'),
    });

    const stats = [
      {
        name: 'GÜNLÜK',
        value: rentals.filter((r) => r.isDaily === 'true').length,
        fill: '#a855f7',
      },
      {
        name: 'UZUN DÖNEM',
        value: rentals.filter((r) => r.isDaily === 'false').length,
        fill: '#3b82f6',
      },
    ];

    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get(
  '/agent-revenue-analysis',
  authenticate,
  async (req: any, res: any) => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Yetkisiz' });

    const { year, month } = req.query;

    try {
      const allOrders = await db.query.orders.findMany({
        // 🚀 KRİTİK DEĞİŞİKLİK: Sadece 'paid' değil, 'cancelled' OLMAYAN her şeyi çekiyoruz.
        // Yani: paid, shipped, delivered durumundaki tüm cirolar grafiğe girer.
        where: and(
          and(ne(orders.status, 'cancelled'), ne(orders.status, 'returned')),
        ),
        with: { seller: true },
      });

      const revenueMap: Record<string, number> = {};

      allOrders.forEach((o) => {
        if (!o.createdAt) return;
        const d = new Date(o.createdAt);

        const matchYear = year ? d.getFullYear() === Number(year) : true;
        const matchMonth = month ? d.getMonth() === Number(month) : true;

        if (matchYear && matchMonth) {
          const agentName = o.seller?.fullName || 'Bilinmeyen';
          // Fiyatı sayıya çevirip ekliyoruz
          revenueMap[agentName] =
            (revenueMap[agentName] || 0) + Number(o.totalPrice || 0);
        }
      });

      // Ciroya göre büyükten küçüğe sırala
      const result = Object.entries(revenueMap)
        .map(([name, revenue]) => ({ name, revenue }))
        .sort((a, b) => b.revenue - a.revenue);

      // console.log(`📊 FİLTRE: Yıl ${year}, Ay ${month} için sonuçlar:`, result);

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
export default router;
