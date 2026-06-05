import { ReactNode, useState } from 'react';
import {
  ClipboardList,
  Package,
  Boxes,
  Moon,
  Sun,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Webhook,
  Users,
  BarChart3,
  Tags,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';

type Page = 'orders' | 'customers' | 'inventory' | 'products' | 'webhooks' | 'analytics' | 'categories' | 'collections';

type LayoutProps = {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
};

const navItems: { id: Page; label: string; icon: typeof ClipboardList }[] = [
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'collections', label: 'Collections', icon: Layers },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
];

export function Layout({
  children,
  currentPage,
  onNavigate,
  onLogout,
  theme,
  onThemeToggle,
}: LayoutProps) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  );

  const toggleCollapse = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar_collapsed', String(newState));
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <nav
        className={clsx(
          'relative flex flex-col border-r p-3 transition-all duration-200',
          collapsed ? 'w-14' : 'w-56'
        )}
        style={{ background: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
      >
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapse}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 p-1 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 mb-4">
          <svg
            className="w-5 h-5 flex-shrink-0"
            viewBox="0 0 88 88"
            fill="currentColor"
            style={{ color: 'var(--text)' }}
          >
            <path d="M46 84V88H42V84H46ZM84 46V42C84 21.0132 66.9868 4 46 4H42C21.0132 4 4 21.0132 4 42V46C4 66.9868 21.0132 84 42 84V88C18.804 88 0 69.196 0 46V42C1.01484e-06 19.1665 18.221 0.588624 40.916 0.0136719L42 0H46L47.084 0.0136719C69.779 0.588625 88 19.1665 88 42V46L87.9863 47.084C87.4114 69.779 68.8335 88 46 88V84C66.9868 84 84 66.9868 84 46Z" />
            <path d="M55.6 29C60.4 29 63.6 32.2 63.6 37V61H57.2V40.2C57.2 37 55.6 35.4 52.4 35.4C49.2 35.4 47.6 37 47.6 40.2V61H41.2V35.4H31.6V61H25.2V29H47.6V37C47.6 32.2 50.8 29 55.6 29Z" />
          </svg>
          {!collapsed && (
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              merchant
            </span>
          )}
        </div>

        {/* Nav items */}
        <div className="space-y-0.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-sm transition-colors',
                currentPage === id ? 'font-medium' : 'hover:bg-[var(--bg-hover)]'
              )}
              style={{
                color: currentPage === id ? 'var(--sidebar-active-text)' : 'var(--sidebar-text)',
                background: currentPage === id ? 'var(--sidebar-active-bg)' : undefined,
              }}
            >
              <Icon size={16} className="flex-shrink-0 opacity-60" />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          className="mt-auto pt-3 space-y-0.5 border-t"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <button
            onClick={onThemeToggle}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-sm transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--sidebar-text)' }}
          >
            {theme === 'dark' ? (
              <Sun size={16} className="flex-shrink-0 opacity-60" />
            ) : (
              <Moon size={16} className="flex-shrink-0 opacity-60" />
            )}
            {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-sm transition-colors hover:bg-red-500/10 hover:text-red-500"
            style={{ color: 'var(--sidebar-text)' }}
          >
            <LogOut size={16} className="flex-shrink-0 opacity-60" />
            {!collapsed && <span>Disconnect</span>}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-content)' }}>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
