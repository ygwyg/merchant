/**
 * Analytics Dashboard
 *
 * Financial intelligence and profitability visualization interface.
 * Provides summary cards, trend charts, product profitability tables,
 * and inventory valuation for store operators.
 *
 * @author Basem Hegazy <basem.hegazy@outlook.com>
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, type ProductProfitability } from '../lib/api';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = abs % 100;
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars.toLocaleString()}.${centsPart.toString().padStart(2, '0')}`;
}

function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${pct.toFixed(2)}%`;
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-sm p-4 border flex flex-col gap-1"
      style={{
        background: 'var(--bg-card)',
        borderColor: accent ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-lg font-semibold font-mono" style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}>
        {value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-sm border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ProfitabilityTable({
  products,
  title,
}: {
  products: ProductProfitability[];
  title: string;
}) {
  return (
    <div
      className="rounded-sm border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <div className="px-4 py-3 border-b text-sm font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left px-4 py-2 font-medium">Product</th>
              <th className="text-right px-4 py-2 font-medium">Sold</th>
              <th className="text-right px-4 py-2 font-medium">Revenue</th>
              <th className="text-right px-4 py-2 font-medium">Cost</th>
              <th className="text-right px-4 py-2 font-medium">Profit</th>
              <th className="text-right px-4 py-2 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product_id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-4 py-2" style={{ color: 'var(--text)' }}>{p.product_title}</td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{p.units_sold}</td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatCents(p.revenue_cents)}</td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatCents(p.cost_cents)}</td>
                <td
                  className="px-4 py-2 text-right font-mono"
                  style={{ color: p.gross_profit_cents >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {formatCents(p.gross_profit_cents)}
                </td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {formatBps(p.gross_margin_bps)}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No product data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHART_TEXT = '#a8a29e';
const CHART_GRID = '#f0ece3';

export function Analytics() {
  const trendDays = 30;

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: () => api.getAnalyticsDashboard(),
  });

  const { data: trends, isLoading: trendLoading } = useQuery({
    queryKey: ['analytics-trends', trendDays],
    queryFn: () => api.getAnalyticsTrends(trendDays),
  });

  const { data: valuation, isLoading: valLoading } = useQuery({
    queryKey: ['analytics-valuation'],
    queryFn: () => api.getInventoryValuation(),
  });

  const { data: products, isLoading: prodLoading } = useQuery({
    queryKey: ['analytics-products'],
    queryFn: () => api.getAnalyticsProducts(),
  });

  const isLoading = dashLoading || trendLoading || valLoading || prodLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  const summary = dashboard?.summary;
  const trendItems = trends?.items || [];
  const valItems = valuation?.items || [];
  const allProducts = products?.items || [];

  // Chart colors
  const revColor = '#f5c747';
  const costColor = '#ef4444';
  const profitColor = '#22c55e';
  const marginColor = '#3b82f6';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Analytics</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Gross Profit"
          value={summary ? formatCents(summary.gross_profit_cents) : '—'}
          sub={summary ? `Margin ${formatBps(summary.gross_margin_bps)}` : undefined}
          accent
        />
        <SummaryCard
          label="Total Revenue"
          value={summary ? formatCents(summary.total_revenue_cents) : '—'}
          sub={summary ? `${summary.total_orders} orders` : undefined}
        />
        <SummaryCard
          label="Cost of Goods"
          value={summary ? formatCents(summary.total_cost_cents) : '—'}
        />
        <SummaryCard
          label="Inventory Value"
          value={summary ? formatCents(summary.inventory_value_cents) : '—'}
          sub={valuation ? `${valuation.totals.total_on_hand} units` : undefined}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue vs Cost Trend */}
        <ChartCard title="Revenue vs Cost">
          {trendItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendItems}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={revColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={revColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={costColor} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={costColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={{ stroke: CHART_GRID }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => `$${(v / 100).toLocaleString()}`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)' }}
                  formatter={(value) => [formatCents(Number(value)), '']}
                />
                <Area type="monotone" dataKey="revenue_cents" stroke={revColor} fill="url(#revGrad)" strokeWidth={2} name="Revenue" />
                <Area type="monotone" dataKey="cost_cents" stroke={costColor} fill="url(#costGrad)" strokeWidth={2} name="Cost" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-sm" style={{ color: 'var(--text-muted)' }}>
              No trend data available
            </div>
          )}
        </ChartCard>

        {/* Gross Profit Trend */}
        <ChartCard title="Gross Profit Trend">
          {trendItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendItems}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={profitColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={profitColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={{ stroke: CHART_GRID }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => `$${(v / 100).toLocaleString()}`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)' }}
                  formatter={(value) => [formatCents(Number(value)), '']}
                />
                <Area type="monotone" dataKey="profit_cents" stroke={profitColor} fill="url(#profitGrad)" strokeWidth={2} name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-sm" style={{ color: 'var(--text-muted)' }}>
              No trend data available
            </div>
          )}
        </ChartCard>

        {/* Margin Trend */}
        <ChartCard title="Gross Margin Trend">
          {trendItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendItems}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={{ stroke: CHART_GRID }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v) => `${(v / 100).toFixed(1)}%`}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)' }}
                  formatter={(value) => [`${formatBps(Number(value))}`, 'Margin']}
                />
                <Line type="monotone" dataKey="margin_bps" stroke={marginColor} strokeWidth={2} dot={false} name="Margin" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-sm" style={{ color: 'var(--text-muted)' }}>
              No trend data available
            </div>
          )}
        </ChartCard>

        {/* Inventory Valuation Pie */}
        <ChartCard title="Inventory Value by Product">
          {valItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={valItems.slice(0, 8)}
                  dataKey="total_value_cents"
                  nameKey="product_title"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                  paddingAngle={2}
                >
                  {valItems.slice(0, 8).map((_, i) => {
                    const colors = ['#f5c747', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
                    return <Cell key={i} fill={colors[i % colors.length]} />;
                  })}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text)' }}
                  formatter={(value) => [formatCents(Number(value)), '']}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-sm" style={{ color: 'var(--text-muted)' }}>
              No inventory data
            </div>
          )}
        </ChartCard>
      </div>

      {/* Top & Bottom Products */}
      {(dashboard?.top_products?.length || dashboard?.bottom_products?.length) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dashboard?.top_products && (
            <ProfitabilityTable products={dashboard.top_products} title="Most Profitable Products" />
          )}
          {dashboard?.bottom_products && (
            <ProfitabilityTable products={dashboard.bottom_products} title="Least Profitable Products" />
          )}
        </div>
      ) : null}

      {/* Product Profitability Table */}
      {allProducts.length > 0 && (
        <ProfitabilityTable products={allProducts} title="All Products — Profitability" />
      )}

      {/* Inventory Valuation Table */}
      {valItems.length > 0 && (
        <div
          className="rounded-sm border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="px-4 py-3 border-b text-sm font-medium flex items-center justify-between" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <span>Inventory Valuation</span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              Total: {formatCents(valuation?.totals.total_value_cents || 0)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left px-4 py-2 font-medium">SKU</th>
                  <th className="text-left px-4 py-2 font-medium">Product</th>
                  <th className="text-right px-4 py-2 font-medium">On Hand</th>
                  <th className="text-right px-4 py-2 font-medium">Unit Cost</th>
                  <th className="text-right px-4 py-2 font-medium">Total Value</th>
                  <th className="text-right px-4 py-2 font-medium">Potential Revenue</th>
                </tr>
              </thead>
              <tbody>
                {valItems.map((item) => (
                  <tr key={item.sku} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-4 py-2 font-mono" style={{ color: 'var(--text-secondary)' }}>{item.sku}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--text)' }}>{item.product_title}</td>
                    <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{item.on_hand}</td>
                    <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatCents(item.cost_cents)}</td>
                    <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text)' }}>{formatCents(item.total_value_cents)}</td>
                    <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatCents(item.potential_revenue_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium" style={{ borderColor: 'var(--border)' }}>
                  <td colSpan={2} className="px-4 py-2" style={{ color: 'var(--text)' }}>Total</td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text)' }}>{valuation?.totals.total_on_hand}</td>
                  <td />
                  <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text)' }}>
                    {valuation ? formatCents(valuation.totals.total_value_cents) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--text-muted)' }}>
                    {valuation ? formatCents(valuation.totals.total_potential_revenue_cents) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
