/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { NavItem } from '../../components/layout/NavItem';

// Mock next/link to render a simple <a> tag
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

/**
 * Property 6: Active route indication
 *
 * For any valid navigation route path, exactly one NavItem in the sidebar should
 * display the active indicator (2px left border in primary color with surface-container
 * background), and that item's href should match the current route.
 *
 * Tag: Feature: stitch-ui-implementation, Property 6: Active route indication
 * Validates: Requirements 2.3
 */

// --- Valid navigation routes ---

const validRoutes = ['/inbox', '/knowledge', '/analytics', '/customers', '/settings', '/team'] as const;

const activeClasses = ['bg-surface-container', 'border-l-primary', 'text-primary', 'font-medium'];
const stableLayoutClasses = ['border-l-2'];
const inactiveClasses = ['text-gray-600'];

// --- Arbitraries ---

const routeArb = fc.constantFrom(...validRoutes);

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 6: Active route indication', () => {
  it('active NavItem has correct active indicator classes for any valid route', () => {
    fc.assert(
      fc.property(
        routeArb,
        (activeRoute) => {
          const icon = <span data-testid="icon">icon</span>;

          // Render all NavItems with one active (matching activeRoute)
          const { container } = render(
            <nav>
              {validRoutes.map((route) => (
                <NavItem
                  key={route}
                  href={route}
                  icon={icon}
                  label={route.slice(1)} // remove leading /
                  isActive={route === activeRoute}
                />
              ))}
            </nav>,
          );

          const links = container.querySelectorAll('a');

          // Find the active link
          const activeLink = Array.from(links).find((link) => link.getAttribute('href') === activeRoute);
          expect(activeLink).toBeDefined();

          // Verify the active NavItem has all active classes
          for (const cls of activeClasses) {
            expect(activeLink!.className).toContain(cls);
          }
          for (const cls of stableLayoutClasses) {
            expect(activeLink!.className).toContain(cls);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('inactive NavItems do NOT have active indicator classes for any valid route', () => {
    fc.assert(
      fc.property(
        routeArb,
        (activeRoute) => {
          const icon = <span data-testid="icon">icon</span>;

          const { container } = render(
            <nav>
              {validRoutes.map((route) => (
                <NavItem
                  key={route}
                  href={route}
                  icon={icon}
                  label={route.slice(1)}
                  isActive={route === activeRoute}
                />
              ))}
            </nav>,
          );

          const links = container.querySelectorAll('a');

          // Check all inactive links
          const inactiveLinks = Array.from(links).filter(
            (link) => link.getAttribute('href') !== activeRoute,
          );

          for (const link of inactiveLinks) {
            for (const cls of activeClasses) {
              expect(link.className).not.toContain(cls);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exactly one NavItem is active and its href matches the current route', () => {
    fc.assert(
      fc.property(
        routeArb,
        (activeRoute) => {
          const icon = <span data-testid="icon">icon</span>;

          const { container } = render(
            <nav>
              {validRoutes.map((route) => (
                <NavItem
                  key={route}
                  href={route}
                  icon={icon}
                  label={route.slice(1)}
                  isActive={route === activeRoute}
                />
              ))}
            </nav>,
          );

          const links = container.querySelectorAll('a');

          // Count how many links have ALL active classes
          const activeLinks = Array.from(links).filter((link) =>
            activeClasses.every((cls) => link.className.includes(cls)),
          );

          // Exactly one NavItem should be active
          expect(activeLinks).toHaveLength(1);

          // That active NavItem's href should match the current route
          expect(activeLinks[0].getAttribute('href')).toBe(activeRoute);
        },
      ),
      { numRuns: 100 },
    );
  });
});
