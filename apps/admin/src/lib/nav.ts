import { hasAnyPermission, type Permission, type StaffRole } from '@forest/contracts/core';

/**
 * Sidebar (docs/08, design AdminNav): groups and items. An item is shown only when the role holds
 * one of its permissions (the API enforces the same map). `href: null` = page not built yet →
 * rendered disabled, never a dead link. Icons are the design's stroke paths.
 */
export interface NavItem {
  id: string;
  label: string;
  href: string | null;
  icon: string;
  permissions: readonly Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Asosiy',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/',
        icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
        permissions: ['dashboard.view'],
      },
      {
        id: 'analytics',
        label: 'Analitika',
        href: null,
        icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        permissions: ['analytics.view'],
      },
      {
        id: 'heatmap',
        label: 'Heatmap va sessiyalar',
        href: null,
        icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        permissions: ['analytics.view'],
      },
    ],
  },
  {
    label: 'Savdo',
    items: [
      {
        id: 'orders',
        label: 'Buyurtmalar',
        href: '/orders',
        icon: 'M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0',
        permissions: ['orders.view'],
      },
      {
        id: 'customers',
        label: 'Mijozlar',
        href: '/customers',
        icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c1-4 4-6 7-6s6 2 7 6M17 11a3 3 0 1 0 0-6M22 20c-.6-2.5-2-4-4-4.6',
        permissions: ['customers.view'],
      },
      {
        id: 'audiences',
        label: 'Auditoriyalar',
        href: null,
        icon: 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 15v7M2 12h3M19 12h3',
        permissions: ['audiences.edit'],
      },
      {
        id: 'bot',
        label: 'Telegram bot',
        href: null,
        icon: 'M21 4 3 11l6 2 2 6 3-4 5 4z',
        permissions: ['bot.inbox', 'bot.edit'],
      },
    ],
  },
  {
    label: 'Katalog',
    items: [
      {
        id: 'products',
        label: 'Mahsulotlar',
        href: '/products',
        icon: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
        permissions: ['products.view'],
      },
      {
        id: 'stock',
        label: 'MoySklad',
        href: '/moysklad',
        icon: 'M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10',
        permissions: ['moysklad.sync'],
      },
      {
        id: 'reviews',
        label: 'Sharhlar va fotolar',
        href: '/reviews',
        icon: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
        permissions: ['reviews.view'],
      },
    ],
  },
  {
    label: 'Marketing',
    items: [
      {
        id: 'promo',
        label: 'Promo-kodlar',
        href: '/promo',
        icon: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
        permissions: ['promo.edit'],
      },
      {
        id: 'seo',
        label: 'SEO markazi',
        href: null,
        icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6',
        permissions: ['seo.edit'],
      },
      {
        id: 'integrations',
        label: 'Integratsiyalar',
        href: '/integrations',
        icon: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
        permissions: ['integrations.view'],
      },
      {
        id: 'settings',
        label: 'Sozlamalar',
        href: '/settings',
        icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
        permissions: ['settings.staff', 'settings.store', 'settings.delivery', 'audit.view'],
      },
    ],
  },
];

/** Groups with only the items `role` may see; empty groups dropped. */
export function navFor(role: StaffRole): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => hasAnyPermission(role, i.permissions)),
  })).filter((g) => g.items.length > 0);
}

/** Settings sub-pages that exist, in tab order. */
export const SETTINGS_TABS: { href: string; label: string; permissions: readonly Permission[] }[] =
  [
    { href: '/settings/staff', label: 'Xodimlar', permissions: ['settings.staff'] },
    { href: '/settings/delivery', label: 'Yetkazish', permissions: ['settings.delivery'] },
    { href: '/settings/store', label: "Do'kon", permissions: ['settings.store'] },
    { href: '/settings/audit', label: 'Faoliyat jurnali', permissions: ['audit.view'] },
  ];

export function settingsTabsFor(role: StaffRole) {
  return SETTINGS_TABS.filter((t) => hasAnyPermission(role, t.permissions));
}
