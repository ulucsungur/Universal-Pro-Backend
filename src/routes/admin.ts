import { Router } from 'express';
import { db } from '../db';
import { users, listings, orders } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
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

export default router;
