import { useState, useEffect } from 'react';
import { getAuth, setAuth, clearAuth, getTheme, setTheme } from './lib/store';
import { api } from './lib/api';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';
import { Customers } from './pages/Customers';
import { Inventory } from './pages/Inventory';
import { Products } from './pages/Products';
import { Webhooks } from './pages/Webhooks';
import { Analytics } from './pages/Analytics';
import { Categories } from './pages/Categories';
import { Collections } from './pages/Collections';

type Page = 'orders' | 'customers' | 'inventory' | 'products' | 'webhooks' | 'analytics' | 'categories' | 'collections';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>('orders');
  const [theme, setThemeState] = useState<'light' | 'dark'>(getTheme());

  useEffect(() => {
    const auth = getAuth();
    if (auth.isAuthenticated) {
      // Validate the stored credentials
      api
        .getOrders({ limit: 1 })
        .then(() => setIsAuthenticated(true))
        .catch(() => {
          clearAuth();
          setIsAuthenticated(false);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Handle hash routing
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) as Page;
      if (['orders', 'customers', 'inventory', 'products', 'webhooks', 'analytics', 'categories', 'collections'].includes(hash)) {
        setCurrentPage(hash);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleLogin = async (apiUrl: string, apiKey: string) => {
    setAuth(apiUrl, apiKey);
    try {
      await api.getOrders({ limit: 1 });
      setIsAuthenticated(true);
    } catch {
      clearAuth();
      throw new Error('Invalid credentials');
    }
  };

  const handleLogout = () => {
    clearAuth();
    setIsAuthenticated(false);
  };

  const handleThemeToggle = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    setThemeState(newTheme);
  };

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-app)' }}
      >
        <div className="animate-pulse text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={(page) => {
        window.location.hash = page;
        setCurrentPage(page);
      }}
      onLogout={handleLogout}
      theme={theme}
      onThemeToggle={handleThemeToggle}
    >
      {currentPage === 'orders' && <Orders />}
      {currentPage === 'customers' && <Customers />}
      {currentPage === 'inventory' && <Inventory />}
      {currentPage === 'products' && <Products />}
      {currentPage === 'webhooks' && <Webhooks />}
      {currentPage === 'analytics' && <Analytics />}
      {currentPage === 'categories' && <Categories />}
      {currentPage === 'collections' && <Collections />}
    </Layout>
  );
}
