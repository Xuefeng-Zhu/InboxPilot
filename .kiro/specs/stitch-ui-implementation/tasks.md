# Implementation Plan: Stitch UI Implementation

## Overview

Implement the "Efficient Precision" Stitch design system into the InboxPilot Next.js application. The approach follows a foundation-up strategy: design tokens → component library → layout shell → page compositions → property tests. All work is in TypeScript with Tailwind CSS 3.4, React 18, and vitest + fast-check for testing.

## Tasks

- [x] 1. Design Token Foundation
  - [x] 1.1 Extend tailwind.config.ts with Stitch design tokens
    - Add color palette: primary (indigo), ai (purple), status (open/escalated/resolved/ai_draft), surface tiers
    - Add fontFamily: Inter as sans, JetBrains Mono as mono
    - Add fontSize scale: display-sm, headline-sm, body-md, body-sm, label-md, label-sm, mono-sm with line-height and font-weight
    - Add spacing tokens: container-margin, section-padding, element-gap, tight-gap, sidebar-w, inbox-list-w
    - Add borderRadius tokens: sm, DEFAULT, md, lg, xl, full
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Configure Inter and JetBrains Mono fonts via next/font/google in app/layout.tsx
    - Import Inter and JetBrains Mono from next/font/google
    - Apply font CSS variables to the HTML element
    - Update Tailwind fontFamily to reference the CSS variables
    - _Requirements: 1.2_

  - [x] 1.3 Write property test for design token resolution completeness
    - **Property 1: Design token resolution completeness**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6**

- [x] 2. Component Library — Buttons and Form Inputs
  - [x] 2.1 Create utility helper (components/ui/cn.ts)
    - Implement a simple `cn()` helper using clsx for conditional class composition
    - _Requirements: 3.1_

  - [x] 2.2 Implement Button component (components/ui/Button.tsx)
    - Create Button with variants: primary, secondary, ghost, ai
    - Implement sizes: sm (h-8), md (h-9), lg (h-10)
    - Apply rounded, font-medium, transition-colors base styles
    - Handle disabled state with opacity-50 and pointer-events-none
    - Export ButtonProps interface
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.3 Implement Input component (components/ui/Input.tsx)
    - Create Input with label, error state, focus ring styling
    - Apply shared base classes: border, rounded, text-body-md, focus:border-primary, focus:ring
    - Render error message below field with red styling and aria-describedby
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 2.4 Implement Select component (components/ui/Select.tsx)
    - Create Select with label, error state, options prop
    - Style consistently with Input component
    - _Requirements: 4.3_

  - [x] 2.5 Implement Textarea component (components/ui/Textarea.tsx)
    - Create Textarea with label, error state
    - Style consistently with Input component
    - _Requirements: 4.4_

  - [x] 2.6 Write property test for Button variant-size-state class correctness
    - **Property 2: Button variant-size-state class correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x] 2.7 Write property test for form element base styling consistency
    - **Property 3: Form element base styling consistency**
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [x] 2.8 Write property test for input error state rendering
    - **Property 4: Input error state rendering**
    - **Validates: Requirements 4.5**

- [x] 3. Component Library — StatusBadge, Card, MetricCard
  - [x] 3.1 Implement StatusBadge component (components/ui/StatusBadge.tsx)
    - Create StatusBadge with status prop: open, escalated, resolved, ai_draft, connected, disconnected
    - Apply pill shape (rounded-full), compact sizing (text-xs, px-2, py-0.5)
    - Map each status to correct background/text color combination
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.2 Implement Card component (components/ui/Card.tsx)
    - Create Card with optional header, elevated prop for shadow
    - Apply white background, 1px border, rounded-lg, section-padding
    - Render header with border-b separator when provided
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 3.3 Implement MetricCard component (components/ui/MetricCard.tsx)
    - Create MetricCard with label, value, optional trend indicator, accent color
    - Display value in display-sm, label in label-md text-gray-500
    - Render trend with green-600 (up) or red-600 (down)
    - _Requirements: 6.3, 10.3_

  - [x] 3.4 Create barrel export file (components/ui/index.ts)
    - Export all UI components from a single entry point
    - _Requirements: 3.1, 4.1, 5.1, 6.1_

  - [x] 3.5 Write property test for StatusBadge color mapping
    - **Property 5: StatusBadge color mapping**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 3.6 Write property test for MetricCard trend color mapping
    - **Property 9: MetricCard trend color mapping**
    - **Validates: Requirements 10.3**

- [x] 4. Checkpoint — Component Library Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Layout Shell
  - [x] 5.1 Implement NavItem component (components/layout/NavItem.tsx)
    - Create NavItem with href, icon, label, isActive props
    - Apply active state: bg-surface-container, border-l-2 border-l-primary, text-primary, font-medium
    - Apply inactive state: text-gray-600, hover:bg-gray-50, hover:text-gray-900
    - Use Next.js Link for client-side navigation
    - _Requirements: 2.3_

  - [x] 5.2 Implement Sidebar component (components/layout/Sidebar.tsx)
    - Render logo + workspace name at top
    - Render navigation links for: Inbox, Knowledge Base, Analytics, Customers, Settings, Team
    - Render user avatar + sign-out at bottom
    - Use usePathname() to determine active route
    - Fixed width at 240px (sidebar-w token)
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 5.3 Implement AppShell component (components/layout/AppShell.tsx)
    - Create flex h-screen layout with Sidebar + main content area
    - Main area: flex-1, overflow-auto, bg-surface-background
    - On viewports < 1024px: hide sidebar, show hamburger button
    - Mobile overlay: slide-over with backdrop, close on backdrop click or Escape
    - _Requirements: 2.1, 2.6, 12.1_

  - [x] 5.4 Create layout barrel export (components/layout/index.ts)
    - Export AppShell, Sidebar, NavItem
    - _Requirements: 2.1_

  - [x] 5.5 Write property test for active route indication
    - **Property 6: Active route indication**
    - **Validates: Requirements 2.3**

- [x] 6. Login and Registration Pages
  - [x] 6.1 Redesign Login page (app/login/page.tsx)
    - Centered card on surface-background (#F9FAFB)
    - InboxPilot logo, email Input, password Input, primary sign-in Button
    - Link to registration page below form
    - Error message display with red styling on auth failure
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 6.2 Redesign Registration page (app/register/page.tsx)
    - Centered card with workspace name, email, password, confirm password inputs
    - Primary sign-up Button
    - _Requirements: 7.3_

- [x] 7. Support Inbox — Three Panel Layout
  - [x] 7.1 Refactor inbox page to use AppShell and three-panel layout (app/inbox/page.tsx)
    - Sidebar (240px via AppShell) + Conversation List (360px, 1px right border) + Detail View (fluid)
    - Below 1024px: stack Conversation List above Detail View
    - At/above 1280px: display all three panels simultaneously
    - _Requirements: 8.1, 12.2, 12.3_

  - [x] 7.2 Update ConversationItem component to match Stitch design
    - 2-line message preview, relative timestamp, channel badge, status badge
    - Unread state: 6px indigo dot + bold subject
    - Selected state: active indicator + surface-container background
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 7.3 Update MessageThread/MessageBubble to match Stitch design
    - Vertical timeline connecting messages
    - Agent/AI replies: white background
    - Customer messages: light gray background
    - AI draft panel with AI_Accent color styling
    - _Requirements: 8.5, 8.6_

  - [x] 7.4 Write property test for conversation item information completeness
    - **Property 7: Conversation item information completeness**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 7.5 Write property test for message bubble sender-type styling
    - **Property 8: Message bubble sender-type styling**
    - **Validates: Requirements 8.5**

- [x] 8. Checkpoint — Core Pages Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Knowledge Base and Analytics Pages
  - [x] 9.1 Redesign Knowledge Base page (app/knowledge/page.tsx)
    - Wrap in AppShell with sidebar
    - Document list in Card components: title, upload date, status badge, action buttons
    - Dashed-border upload drop zone with icon and instructional text
    - Animated progress indicator with AI_Accent color for processing documents
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 9.2 Redesign Analytics Dashboard page (app/analytics/page.tsx)
    - Wrap in AppShell with sidebar
    - Grid of MetricCard components: Total Conversations, Avg Response Time, CSAT Score, AI Resolution Rate
    - Primary color for positive trends, error color for negative trends
    - AI_Accent color for AI-related metrics
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 10. Settings Pages
  - [x] 10.1 Redesign AI Settings page (app/settings/ai/page.tsx)
    - Wrap in AppShell with sidebar
    - Card sections with headline-sm titles and body-md descriptions
    - AI-specific controls styled with AI_Accent color highlights
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 10.2 Redesign Email Settings page (app/settings/email/page.tsx)
    - Wrap in AppShell with sidebar
    - Card sections for configuration
    - Connection status StatusBadge (connected/disconnected)
    - Success notification on save with green status color
    - _Requirements: 11.1, 11.2, 11.4, 11.6_

  - [x] 10.3 Redesign SMS Settings page (app/settings/sms/page.tsx)
    - Wrap in AppShell with sidebar
    - Card sections for configuration
    - Connection status StatusBadge (connected/disconnected)
    - Success notification on save with green status color
    - _Requirements: 11.1, 11.2, 11.5, 11.6_

- [x] 11. Customers/CRM and Team Management Pages
  - [x] 11.1 Create Customers/CRM page (app/customers/page.tsx)
    - Wrap in AppShell with sidebar
    - Display customer list with Card components
    - Use design system typography and spacing tokens
    - _Requirements: 2.2, 12.1_

  - [x] 11.2 Create Team Management page (app/team/page.tsx)
    - Wrap in AppShell with sidebar
    - Display team members with Card components and action buttons
    - Use design system typography and spacing tokens
    - _Requirements: 2.2, 12.1_

- [x] 12. Responsive Behavior and Touch Targets
  - [x] 12.1 Ensure responsive behavior across all pages
    - Verify sidebar collapse below 1024px on all pages
    - Verify three-panel stacking below 1024px for inbox
    - Ensure minimum 44x44px touch targets on viewports below 1024px
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 13. Final Checkpoint — All Tests Pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All components use TypeScript with strict typing
- No new dependencies needed — Inter/JetBrains Mono via next/font/google, existing tailwindcss, vitest, fast-check
- The `cn()` helper uses `clsx` only (no tailwind-merge) since we control all class compositions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.6", "2.7", "2.8", "3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6"] },
    { "id": 5, "tasks": ["5.1", "5.2"] },
    { "id": 6, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 7, "tasks": ["6.1", "6.2", "7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3"] },
    { "id": 9, "tasks": ["7.4", "7.5", "9.1", "9.2"] },
    { "id": 10, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 11, "tasks": ["11.1", "11.2", "12.1"] }
  ]
}
```
