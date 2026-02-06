// backend/src/lib/analytics.ts
export const calculateGPS = (ordersData: any[]) => {
  const total = ordersData.length || 1;

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

  const S_ODR = 100 - (defective / total) * 100;
  const S_LSR = 100 - (lateShipments / total) * 100;
  const S_CR = 100 - (cancelledBySeller / total) * 100;
  const S_RR = 98; // Varsayılan başarı puanı

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
