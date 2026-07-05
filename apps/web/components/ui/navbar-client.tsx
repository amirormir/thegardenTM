'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Menu, Search, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GardenLogo } from './garden-logo';
import { resolveAccountAvatarUrl } from '@/lib/utils/account-avatar';
import { cn } from '@/lib/utils/cn';
import { isPublicRegistrationEnabled } from '@/lib/runtime-flags';

interface NavbarClientProps {
  seasonLabel?: string | null;
}

interface NavItem {
  href: string;
  label: string;
}

function isNavItemActive(pathname: string | null, href: string) {
  if (!pathname) {
    return false;
  }

  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function openCommandPalette() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexus:command-palette:open'));
}

const NotificationBell = dynamic(
  () => import('./notification-bell').then((module) => module.NotificationBell),
  {
    ssr: false,
    loading: () => <div aria-hidden className="h-9 w-9 border border-hairline bg-surface" />,
  },
);

function UserAreaSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden className="h-9 w-9 border border-hairline bg-surface" />
      <div
        aria-hidden
        className="hidden h-9 w-[132px] border border-hairline bg-surface md:block"
      />
    </div>
  );
}

export function NavbarClient({ seasonLabel }: NavbarClientProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [session?.user?.image]);

  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
        role: String(session.user.role),
        teamId: session.user.teamId,
      }
    : null;
  const showRegistrationLink = isPublicRegistrationEnabled;

  const userName = currentUser?.name ?? 'Invite';
  const userRole = currentUser?.role ?? 'USER';
  const avatarSrc = resolveAccountAvatarUrl(currentUser?.image);
  const showAvatar = Boolean(avatarSrc) && !avatarLoadFailed;

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { href: '/', label: 'Accueil' },
      { href: '/league', label: 'Ligue' },
      { href: '/league/stats', label: 'Stats' },
      { href: '/custom', label: 'Custom' },
      { href: '/transfermarket', label: 'Marche' },
      { href: '/draft', label: 'Draft' },
      { href: '/news', label: 'News' },
    ];

    if (currentUser?.teamId) {
      items.push({ href: '/team', label: 'Equipe' });
    }

    return items;
  }, [currentUser?.teamId]);

  const signInHref = useMemo(() => {
    if (!pathname) {
      return '/login';
    }

    const params = new URLSearchParams({ callbackUrl: pathname });
    return `/login?${params.toString()}`;
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 hairline-b bg-background">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-4 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <GardenLogo showLabel={false} imageClassName="h-10 w-10" />
          <div className="flex items-center gap-3">
            <span className="label-mono-strong text-foreground">Garden</span>
            {seasonLabel ? (
              <span className="hidden h-3 w-px bg-hairline md:block" aria-hidden />
            ) : null}
            {seasonLabel ? (
              <span className="hidden label-mono md:inline-block">{seasonLabel}</span>
            ) : null}
          </div>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative pb-1 text-sm transition-colors duration-150',
                  active ? 'text-foreground' : 'text-foreground-dim hover:text-foreground',
                )}
              >
                {item.label}
                {active ? <span className="absolute inset-x-0 -bottom-px h-px bg-accent" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 items-center gap-3 border border-hairline bg-surface px-3 text-sm text-foreground-dim transition-colors duration-150 hover:bg-surface-hover hover:text-foreground md:flex"
            aria-label="Ouvrir la recherche"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Rechercher joueur, equipe...</span>
            <span className="label-mono ml-2 hidden border border-hairline px-1.5 py-0.5 md:inline">
              CMD K
            </span>
          </button>

          <button
            type="button"
            className="border border-hairline bg-surface p-2 text-foreground-dim transition-colors duration-150 hover:bg-surface-hover hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-4 w-4" />
          </button>

          {status === 'loading' ? (
            <UserAreaSkeleton />
          ) : currentUser ? (
            <div className="relative flex items-center gap-3">
              <NotificationBell />
              <button
                type="button"
                onClick={() => setUserMenuOpen((value) => !value)}
                className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface text-foreground-dim transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
                aria-label="Menu utilisateur"
              >
                {showAvatar ? (
                  <img
                    src={avatarSrc ?? undefined}
                    alt={userName}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <UserRound className="h-4 w-4" />
                )}
              </button>

              {userMenuOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-60 border border-hairline bg-surface p-2 shadow-lg">
                  <div className="border-b border-hairline px-3 pb-3 pt-1">
                    <p className="text-sm text-foreground">{userName}</p>
                    <p className="mt-1 label-mono">{userRole}</p>
                  </div>
                  <UserMenuLink href="/profile" onClick={() => setUserMenuOpen(false)}>
                    Mon profil
                  </UserMenuLink>
                  <UserMenuLink href="/bets" onClick={() => setUserMenuOpen(false)}>
                    Mes paris
                  </UserMenuLink>
                  <UserMenuLink href="/notifications" onClick={() => setUserMenuOpen(false)}>
                    Notifications
                  </UserMenuLink>
                  {currentUser.teamId ? (
                    <>
                      <UserMenuLink href="/team" onClick={() => setUserMenuOpen(false)}>
                        Espace equipe
                      </UserMenuLink>
                      <UserMenuLink href="/team/contracts" onClick={() => setUserMenuOpen(false)}>
                        Contrats
                      </UserMenuLink>
                      <UserMenuLink href="/team/budget" onClick={() => setUserMenuOpen(false)}>
                        Budget
                      </UserMenuLink>
                    </>
                  ) : null}
                  {currentUser.role === 'ADMIN' ? (
                    <UserMenuLink href="/admin" onClick={() => setUserMenuOpen(false)}>
                      Back-office
                    </UserMenuLink>
                  ) : null}
                  <button
                    type="button"
                    className="mt-1 w-full border-t border-hairline px-3 py-3 text-left text-sm text-[color:var(--loss)] transition-colors duration-150 hover:bg-surface-hover"
                    onClick={() => void signOut({ callbackUrl: '/' })}
                  >
                    Deconnexion
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={signInHref}
                className="border border-hairline bg-surface px-4 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-surface-hover"
              >
                Connexion
              </Link>
              {showRegistrationLink ? (
                <Link
                  href="/register"
                  className="bg-accent px-4 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-dim"
                >
                  S'inscrire
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-background/80 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.nav
              className="fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-hairline bg-surface lg:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between border-b border-hairline px-6 py-5">
                <div className="flex items-center gap-3">
                  <GardenLogo showLabel={false} imageClassName="h-10 w-10" />
                  <span className="label-mono-strong text-foreground">Garden</span>
                </div>
                <button
                  type="button"
                  className="border border-hairline bg-surface p-2 text-foreground-dim transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Fermer le menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 px-3 py-4">
                {navItems.map((item) => {
                  const active = isNavItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'block border-l-2 px-4 py-3 text-sm transition-colors duration-150',
                        active
                          ? 'border-accent text-foreground'
                          : 'border-transparent text-foreground-dim hover:bg-surface-hover hover:text-foreground',
                      )}
                      onClick={() => setMobileOpen(false)}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                {currentUser?.role === 'ADMIN' ? (
                  <Link
                    href="/admin"
                    className={cn(
                      'block border-l-2 px-4 py-3 text-sm transition-colors duration-150',
                      pathname?.startsWith('/admin')
                        ? 'border-accent text-foreground'
                        : 'border-transparent text-foreground-dim hover:bg-surface-hover hover:text-foreground',
                    )}
                    onClick={() => setMobileOpen(false)}
                  >
                    Back-office
                  </Link>
                ) : null}
              </div>

              <div className="border-t border-hairline px-3 py-4">
                {currentUser ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface text-foreground-dim">
                        {showAvatar ? (
                          <img
                            src={avatarSrc ?? undefined}
                            alt={userName}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarLoadFailed(true)}
                          />
                        ) : (
                          <UserRound className="h-4 w-4" />
                        )}
                      </span>
                      <div>
                        <p className="text-sm text-foreground">{userName}</p>
                        <p className="mt-0.5 label-mono">{userRole}</p>
                      </div>
                    </div>
                    <UserMenuLink href="/profile" onClick={() => setMobileOpen(false)}>
                      Mon profil
                    </UserMenuLink>
                    <UserMenuLink href="/bets" onClick={() => setMobileOpen(false)}>
                      Mes paris
                    </UserMenuLink>
                    <UserMenuLink href="/notifications" onClick={() => setMobileOpen(false)}>
                      Notifications
                    </UserMenuLink>
                    {currentUser.teamId ? (
                      <>
                        <UserMenuLink href="/team/contracts" onClick={() => setMobileOpen(false)}>
                          Contrats
                        </UserMenuLink>
                        <UserMenuLink href="/team/budget" onClick={() => setMobileOpen(false)}>
                          Budget
                        </UserMenuLink>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="mt-1 w-full px-4 py-3 text-left text-sm text-[color:var(--loss)] transition-colors duration-150 hover:bg-surface-hover"
                      onClick={() => void signOut({ callbackUrl: '/' })}
                    >
                      Deconnexion
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 px-3">
                    <Link
                      href={signInHref}
                      className="block border border-hairline bg-surface px-4 py-3 text-center text-sm text-foreground transition-colors duration-150 hover:bg-surface-hover"
                      onClick={() => setMobileOpen(false)}
                    >
                      Connexion
                    </Link>
                    {showRegistrationLink ? (
                      <Link
                        href="/register"
                        className="block bg-accent px-4 py-3 text-center text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-dim"
                        onClick={() => setMobileOpen(false)}
                      >
                        S'inscrire
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            </motion.nav>
          </>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function UserMenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-3 py-2.5 text-sm text-foreground-dim transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </Link>
  );
}
