# Requirements Document

## Introduction

This feature implements the UI design system created in Stitch ("InboxPilot AI Support Dashboard") across the InboxPilot application. The implementation covers design tokens (colors, typography, spacing, shapes), a shared component library, layout shell, and page-level redesigns for all 9 screens: Login, Support Inbox, Knowledge Base, Analytics Dashboard, AI Settings, Email Settings, SMS Settings, Customers/CRM, and Team Management.

The design system follows an "Efficient Precision" philosophy — a three-panel fixed layout optimized for high-velocity support operations, using Indigo as the primary action color, Purple for AI-driven features, and a Canvas-and-Panel tonal layering approach with minimal shadows.

## Glossary

- **Design_Token_Layer**: The Tailwind CSS configuration layer that maps Stitch design tokens (colors, typography, spacing, border radii) to utility classes
- **Layout_Shell**: The persistent application frame consisting of a sidebar navigation (240px), and page content area
- **Sidebar_Navigation**: The fixed-width (240px) left navigation panel with links to all major sections
- **Three_Panel_Layout**: The inbox-specific layout with Sidebar (240px) + Conversation List (360px) + Detail View (fluid)
- **Component_Library**: A set of shared, reusable React components (Button, Input, Badge, Card, etc.) styled according to the Stitch design system
- **Tonal_Layering**: The elevation strategy using background color tiers and 1px borders instead of heavy shadows
- **AI_Accent**: The purple color (#8B5CF6) reserved exclusively for AI-generated content and actions
- **Status_Palette**: Semantic colors for conversation states (Open = orange, Escalated = red, Resolved = green)
- **Active_Indicator**: A 2px vertical primary-color bar on the left edge of the selected item in a list

## Requirements

### Requirement 1: Design Token Configuration

**User Story:** As a developer, I want a centralized design token configuration in Tailwind CSS 3.4, so that all UI elements consistently use the Stitch color palette, typography, spacing, and shape values.

#### Acceptance Criteria

1. THE Design_Token_Layer SHALL extend the Tailwind configuration with the Stitch color palette including primary (#4F46E5), AI accent (#8B5CF6), and status colors (orange #F59E0B, red #EF4444, green #10B981)
2. THE Design_Token_Layer SHALL configure Inter as the default sans-serif font and JetBrains Mono as the monospace font
3. THE Design_Token_Layer SHALL define the typography scale: display-sm (24px/600), headline-sm (18px/600), body-md (14px/400), body-sm (13px/400), label-md (12px/600), label-sm (11px/500), mono-sm (12px/400)
4. THE Design_Token_Layer SHALL define spacing tokens: container-margin (1.5rem), section-padding (1rem), element-gap (0.75rem), tight-gap (0.5rem), sidebar-width (240px), inbox-list-width (360px)
5. THE Design_Token_Layer SHALL define border-radius tokens: sm (0.125rem), DEFAULT (0.25rem), md (0.375rem), lg (0.5rem), xl (0.75rem), full (9999px)
6. THE Design_Token_Layer SHALL define surface color tiers: background (#F9FAFB), surface (#FFFFFF), surface-container (#F0ECF9), border (#E5E7EB)

### Requirement 2: Shared Layout Shell

**User Story:** As a user, I want a consistent navigation sidebar across all authenticated pages, so that I can navigate between sections without confusion.

#### Acceptance Criteria

1. THE Layout_Shell SHALL render a fixed-width Sidebar_Navigation (240px) on the left side of all authenticated pages
2. THE Sidebar_Navigation SHALL display navigation links for: Inbox, Knowledge Base, Analytics, Customers, Settings, and Team
3. THE Sidebar_Navigation SHALL highlight the active route using an Active_Indicator (2px indigo vertical bar on the left edge) and a light surface-container background
4. THE Sidebar_Navigation SHALL display the InboxPilot logo and workspace name at the top
5. THE Sidebar_Navigation SHALL display user avatar and sign-out action at the bottom
6. WHEN the viewport width is below 1024px, THE Layout_Shell SHALL collapse the Sidebar_Navigation into a hamburger menu overlay

### Requirement 3: Component Library — Buttons

**User Story:** As a developer, I want reusable button components that match the Stitch design, so that all interactive actions have consistent styling.

#### Acceptance Criteria

1. THE Component_Library SHALL provide a Button component with variants: primary (solid indigo #4F46E5, white text), secondary (white background, #E5E7EB border, gray-700 text), and ghost (no background, gray-600 text)
2. THE Component_Library SHALL provide a Button component with sizes: sm (h-8, text-sm), md (h-9, text-sm), lg (h-10, text-base)
3. THE Component_Library SHALL style all buttons with 0.25rem border-radius and font-weight 500
4. WHEN a button has the AI variant, THE Component_Library SHALL style it with a purple (#8B5CF6) outline or subtle purple gradient background
5. WHEN a button is in the disabled state, THE Component_Library SHALL reduce opacity to 0.5 and prevent pointer events

### Requirement 4: Component Library — Form Inputs

**User Story:** As a user, I want form inputs that are visually clear and provide feedback on focus, so that I can interact with forms confidently.

#### Acceptance Criteria

1. THE Component_Library SHALL provide an Input component with a 1px #D1D5DB border, 0.25rem border-radius, and 14px font size
2. WHEN an Input receives focus, THE Component_Library SHALL transition the border to indigo (#4F46E5) and display a 2px focus ring in indigo with offset
3. THE Component_Library SHALL provide a Select component styled consistently with the Input component
4. THE Component_Library SHALL provide a Textarea component styled consistently with the Input component
5. IF an Input has a validation error, THEN THE Component_Library SHALL display a red (#EF4444) border and an error message below the field

### Requirement 5: Component Library — Status Badges

**User Story:** As a support agent, I want status badges that are instantly recognizable, so that I can scan conversation states at a glance.

#### Acceptance Criteria

1. THE Component_Library SHALL provide a StatusBadge component with pill shape (full border-radius) and compact sizing (text-xs, px-2, py-0.5)
2. THE Component_Library SHALL style the "open" status with light orange background (orange-50) and dark orange text (orange-700)
3. THE Component_Library SHALL style the "escalated" status with light red background (red-50) and dark red text (red-700)
4. THE Component_Library SHALL style the "resolved" status with light green background (green-50) and dark green text (green-700)
5. THE Component_Library SHALL style the "ai_draft" status with light purple background (purple-50) and dark purple text (purple-700)

### Requirement 6: Component Library — Cards and Panels

**User Story:** As a user, I want content organized in visually distinct panels, so that I can distinguish between different sections of information.

#### Acceptance Criteria

1. THE Component_Library SHALL provide a Card component with white background, 1px #E5E7EB border, 0.5rem border-radius, and 1rem internal padding
2. THE Component_Library SHALL provide a Card component that supports an optional header section separated by a 1px border-bottom
3. THE Component_Library SHALL provide a MetricCard variant that displays a large bold metric value, a label, and an optional trend indicator
4. WHEN a Card represents a temporary overlay (popover or modal), THE Component_Library SHALL apply a diffused shadow (0px 4px 12px rgba(0,0,0,0.05))

### Requirement 7: Login and Registration Pages

**User Story:** As a new or returning user, I want a clean, branded login experience, so that I feel confident using the platform.

#### Acceptance Criteria

1. THE Login page SHALL display a centered card on the surface background (#F9FAFB) containing the InboxPilot logo, email input, password input, and a primary sign-in button
2. THE Login page SHALL include a link to the registration page below the form
3. THE Registration page SHALL display a centered card containing workspace name input, email input, password input, confirm password input, and a primary sign-up button
4. IF authentication fails, THEN THE Login page SHALL display an error message styled with the error color (#EF4444) below the form

### Requirement 8: Support Inbox — Three Panel Layout

**User Story:** As a support agent, I want a three-panel inbox view, so that I can see my conversation list and message details simultaneously.

#### Acceptance Criteria

1. THE Three_Panel_Layout SHALL render the Sidebar_Navigation (240px), a Conversation List panel (360px with 1px right border), and a fluid-width Detail View
2. THE Conversation List SHALL display conversation items with: 2-line message preview, relative timestamp (e.g., "2m ago"), channel badge (Email/SMS), and status badge
3. WHEN a conversation is unread, THE Conversation List SHALL display a 6px indigo dot and bold subject line on the conversation item
4. WHEN a conversation is selected, THE Conversation List SHALL highlight it with an Active_Indicator and light surface-container background
5. THE Detail View SHALL display the message thread with a vertical timeline connecting messages, distinct styling for agent replies (white background) vs customer messages (light gray background)
6. THE Detail View SHALL display an AI draft panel styled with the AI_Accent color when an AI-generated response is available

### Requirement 9: Knowledge Base Page

**User Story:** As a support manager, I want a knowledge base management page, so that I can upload and manage documents used by the AI.

#### Acceptance Criteria

1. THE Knowledge Base page SHALL use the Layout_Shell with sidebar and a fluid content area
2. THE Knowledge Base page SHALL display a list of documents in Card components with document title, upload date, processing status badge, and action buttons
3. THE Knowledge Base page SHALL provide an upload area styled as a dashed-border drop zone with an icon and instructional text
4. WHEN a document is processing, THE Knowledge Base page SHALL display an animated progress indicator with the AI_Accent color

### Requirement 10: Analytics Dashboard Page

**User Story:** As a support manager, I want an analytics dashboard, so that I can track team performance and customer satisfaction metrics.

#### Acceptance Criteria

1. THE Analytics Dashboard SHALL use the Layout_Shell with sidebar and a fluid content area
2. THE Analytics Dashboard SHALL display key metrics in a grid of MetricCard components (e.g., Total Conversations, Avg Response Time, CSAT Score, AI Resolution Rate)
3. THE Analytics Dashboard SHALL use the primary color for positive trends and the error color for negative trends
4. THE Analytics Dashboard SHALL style AI-related metrics (AI Resolution Rate, AI Confidence) using the AI_Accent color

### Requirement 11: Settings Pages (AI, Email, SMS)

**User Story:** As an admin, I want settings pages organized in a tabbed or section layout, so that I can configure AI behavior, email integration, and SMS integration separately.

#### Acceptance Criteria

1. THE Settings pages SHALL use the Layout_Shell with sidebar and a fluid content area
2. THE Settings pages SHALL organize configuration into Card sections with headline-sm titles and body-md descriptions
3. THE AI Settings page SHALL style AI-specific controls (model selection, temperature slider, prompt editor) with the AI_Accent color for highlights
4. THE Email Settings page SHALL display connection status using a StatusBadge (connected = green, disconnected = red)
5. THE SMS Settings page SHALL display connection status using a StatusBadge (connected = green, disconnected = red)
6. WHEN a settings form is saved successfully, THE Settings pages SHALL display a success notification with the green status color

### Requirement 12: Responsive Behavior

**User Story:** As a user on varying screen sizes, I want the interface to adapt gracefully, so that I can use InboxPilot on tablets and smaller displays.

#### Acceptance Criteria

1. WHEN the viewport width is below 1024px, THE Layout_Shell SHALL collapse the sidebar into a toggle-accessible overlay
2. WHEN the viewport width is below 1024px, THE Three_Panel_Layout SHALL stack the Conversation List above the Detail View instead of side-by-side
3. WHILE the viewport width is at or above 1280px, THE Three_Panel_Layout SHALL display all three panels simultaneously
4. THE Layout_Shell SHALL maintain minimum touch targets of 44x44px for all interactive elements on viewports below 1024px
