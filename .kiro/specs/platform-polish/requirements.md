# Requirements Document

## Introduction

The Fund for Indonesia platform currently has multiple dead links, non-functional buttons, and missing features that degrade user experience. This specification covers all "platform polish" work needed to eliminate 404 pages from footer links, wire up dead buttons in the account page, add missing account management features (settings, my campaigns), improve navigation (notification bell linking to inbox), and enhance search with category filtering. The goal is to bring all existing UI affordances to a functional state and fill critical feature gaps.

## Glossary

- **Platform**: The Fund for Indonesia web application built with Next.js 14+ App Router
- **Static_Page**: A server-rendered page with informational content that does not require authentication
- **Footer**: The site-wide footer section rendered at the bottom of pages on desktop viewports (≥1024px)
- **Account_Page**: The authenticated user's account dashboard at `/akun`
- **Settings_Page**: The user settings page at `/akun/pengaturan` for managing profile and credentials
- **My_Campaigns_Page**: The page at `/akun/kampanye-saya` listing campaigns created by the authenticated user
- **DesktopHeader**: The desktop navigation header component containing search, nav links, and notification bell
- **BottomNavBar**: The mobile bottom navigation component
- **Notification_Bell**: The bell icon button in the DesktopHeader that indicates unread notifications
- **Search_Page**: The campaign search results page at `/search`
- **Category_Filter**: A UI control on the search results page that allows filtering results by campaign category (single-select)
- **Top_Up_Dialog**: A modal dialog triggered by the "Top Up" button for adding balance to the donation wallet
- **Verification_Dialog**: A modal dialog triggered by the "Verifikasi" button for starting identity verification
- **Campaign_Creator**: A user with the CAMPAIGN_CREATOR role who can create and manage campaigns
- **Authenticated_User**: Any user who has logged in regardless of role

## Requirements

### Requirement 1: Static Informational Pages

**User Story:** As a visitor, I want to access informational pages linked from the footer, so that I can learn about the platform, get help, and understand its policies.

#### Acceptance Criteria

1. WHEN a visitor navigates to `/about`, THE Platform SHALL render a static page with the heading "Tentang Kami" and at least 200 characters of descriptive content about the organization
2. WHEN a visitor navigates to `/careers`, THE Platform SHALL render a static page with the heading "Karir" and placeholder career information
3. WHEN a visitor navigates to `/press`, THE Platform SHALL render a static page with the heading "Media" and placeholder press information
4. WHEN a visitor navigates to `/help`, THE Platform SHALL render a static page with the heading "Help Center" and at least three categorized help topics
5. WHEN a visitor navigates to `/faq`, THE Platform SHALL render a static page with the heading "FAQ" containing at least five frequently asked questions with answers displayed in an accordion/collapsible format
6. WHEN a visitor navigates to `/contact`, THE Platform SHALL render a static page with the heading "Kontak" containing contact methods (email, phone, social media links)
7. WHEN a visitor navigates to `/terms`, THE Platform SHALL render a static page with the heading "Syarat & Ketentuan" containing terms of service text
8. WHEN a visitor navigates to `/privacy`, THE Platform SHALL render a static page with the heading "Kebijakan Privasi" containing privacy policy text
9. THE Platform SHALL return HTTP 200 status codes for all eight static pages listed above
10. ALL static pages SHALL be accessible without authentication
11. ALL static pages SHALL include SEO metadata (title and description meta tags)

### Requirement 2: User Settings Page

**User Story:** As an authenticated user, I want to access a settings page from my account, so that I can update my profile name, avatar, and password.

#### Acceptance Criteria

1. WHEN an Authenticated_User navigates to `/akun/pengaturan`, THE Settings_Page SHALL display the user's current name, email (read-only), and avatar
2. WHEN an Authenticated_User submits a name between 2 and 50 characters on the Settings_Page, THE Platform SHALL update the user's name in the database and confirm the change with a success message
3. IF an Authenticated_User submits a name shorter than 2 characters or longer than 50 characters, THEN THE Settings_Page SHALL display a validation error without saving
4. WHEN an Authenticated_User uploads a new avatar image (PNG, JPG, or WebP, max 2MB) on the Settings_Page, THE Platform SHALL update the user's avatar and display the new image
5. IF an Authenticated_User uploads an avatar file exceeding 2MB or not in PNG/JPG/WebP format, THEN THE Settings_Page SHALL display a validation error indicating the constraint
6. WHEN an Authenticated_User submits a password change, THE Settings_Page SHALL require the current password, new password (min 8 characters), and password confirmation
7. IF the current password provided does not match the stored password, THEN THE Settings_Page SHALL display an error "Password saat ini salah" without saving
8. IF the new password does not match the confirmation field, THEN THE Settings_Page SHALL display a validation error without saving
9. IF the new password is shorter than 8 characters, THEN THE Settings_Page SHALL display a validation error indicating the minimum length
10. IF an unauthenticated visitor navigates to `/akun/pengaturan`, THEN THE Platform SHALL redirect the visitor to `/login`
11. WHEN an Authenticated_User clicks "Pengaturan" on the Account_Page, THE Platform SHALL navigate to `/akun/pengaturan`

### Requirement 3: My Campaigns Page

**User Story:** As a campaign creator, I want to see a list of all campaigns I have created, so that I can manage and monitor their progress.

#### Acceptance Criteria

1. WHEN a Campaign_Creator navigates to `/akun/kampanye-saya`, THE My_Campaigns_Page SHALL display a list of all campaigns created by that user ordered by creation date descending
2. THE My_Campaigns_Page SHALL display each campaign's title, cover image thumbnail, collected amount, target amount, status badge, and progress percentage
3. WHEN a Campaign_Creator clicks on a campaign in the list, THE Platform SHALL navigate to that campaign's detail page (`/campaign/[slug]`)
4. WHEN a Campaign_Creator has no campaigns, THE My_Campaigns_Page SHALL display an empty state with a call-to-action button linking to `/campaign/create`
5. WHEN an Authenticated_User clicks "Galang Dana Saya" on the Account_Page, THE Platform SHALL navigate to `/akun/kampanye-saya` (replacing the current link to `/campaign/create`)
6. IF an unauthenticated visitor navigates to `/akun/kampanye-saya`, THEN THE Platform SHALL redirect the visitor to `/login`
7. IF a DONOR (non-creator) navigates to `/akun/kampanye-saya`, THE My_Campaigns_Page SHALL display an empty state with a message "Anda belum memiliki kampanye" and a CTA to start verification
8. THE My_Campaigns_Page SHALL display campaigns in pages of 10 items, with pagination controls when the total exceeds 10

### Requirement 4: Notification Bell Navigation

**User Story:** As an authenticated user, I want the notification bell in the header to navigate me to the inbox page, so that I can quickly access my notifications.

#### Acceptance Criteria

1. WHEN an Authenticated_User clicks the Notification_Bell in the DesktopHeader, THE Platform SHALL navigate to `/inbox`
2. WHILE there are unread notifications, THE Notification_Bell SHALL display a badge showing the unread notification count
3. IF the unread notification count exceeds 99, THEN THE Notification_Bell SHALL display "99+" as the badge text
4. WHILE there are no unread notifications, THE Notification_Bell SHALL display without a badge
5. THE Notification_Bell SHALL only be visible to Authenticated_Users
6. THE BottomNavBar SHALL display an unread notification count badge on the "Inbox" tab icon when unread notifications exist
7. THE Platform SHALL refresh the unread notification count on each page navigation

### Requirement 5: Top Up Button Functionality

**User Story:** As an authenticated user, I want the Top Up button on my account page to initiate a balance top-up flow, so that I can add funds to my donation wallet.

#### Acceptance Criteria

1. WHEN an Authenticated_User clicks the "Top Up" button on the Account_Page balance card, THE Platform SHALL open the Top_Up_Dialog
2. THE Top_Up_Dialog SHALL display preset amount options (Rp25.000, Rp50.000, Rp100.000, Rp250.000) and a custom amount input field
3. WHEN an Authenticated_User selects an amount and confirms in the Top_Up_Dialog, THE Platform SHALL display a payment method selection step with available options (BCA, Mandiri, BNI, GoPay, OVO, Dana)
4. IF an Authenticated_User enters an amount less than Rp10.000 in the Top_Up_Dialog, THEN THE Top_Up_Dialog SHALL display a validation error indicating the minimum amount
5. IF an Authenticated_User enters an amount exceeding Rp10.000.000 in the Top_Up_Dialog, THEN THE Top_Up_Dialog SHALL display a validation error indicating the maximum amount
6. IF an Authenticated_User enters non-numeric characters in the custom amount field, THEN THE Top_Up_Dialog SHALL only accept numeric input
7. WHEN an Authenticated_User selects a payment method and confirms, THE Platform SHALL create a pending top-up record, display a success confirmation message with payment instructions, and close the dialog
8. WHEN an Authenticated_User closes the Top_Up_Dialog without confirming (X button, click outside, or ESC key), THE Platform SHALL discard the selection and return to the Account_Page without changes

### Requirement 6: Verification Button Functionality

**User Story:** As an unverified user, I want the Verifikasi button on my account page to start the identity verification process, so that I can become eligible to create campaigns.

#### Acceptance Criteria

1. WHEN an unverified Authenticated_User clicks the "Verifikasi" button on the Account_Page, THE Platform SHALL open the Verification_Dialog
2. THE Verification_Dialog SHALL present options for verification type: KTP (personal) or Organization
3. WHEN an Authenticated_User selects KTP verification type, THE Verification_Dialog SHALL require: full name (2-100 chars) and NIK (exactly 16 digits)
4. WHEN an Authenticated_User selects Organization verification type, THE Verification_Dialog SHALL require: organization name (2-100 chars) and registration number (min 5 chars)
5. WHEN an Authenticated_User submits valid verification information, THE Platform SHALL save the verification request, update the user's `verificationType` field, set `isVerified` to true, upgrade the user's role to CAMPAIGN_CREATOR, and display a confirmation message
6. IF the verification submission fails due to missing required fields, THEN THE Verification_Dialog SHALL display specific field-level validation errors
7. IF the NIK is not exactly 16 digits, THEN THE Verification_Dialog SHALL display "NIK harus 16 digit"
8. IF an already-verified Authenticated_User clicks the verification area, THEN THE Platform SHALL display the current verification status instead of the dialog
9. WHEN an Authenticated_User closes the Verification_Dialog without submitting (X button, click outside, or ESC key), THE Platform SHALL discard the input and return to the Account_Page

### Requirement 7: Search Category Filtering

**User Story:** As a visitor, I want to filter search results by campaign category, so that I can find campaigns relevant to my interests more efficiently.

#### Acceptance Criteria

1. THE Search_Page SHALL display a Category_Filter bar containing all available campaign categories fetched from the Category model in the database
2. THE Category_Filter SHALL allow only one category to be selected at a time, with the active category visually highlighted
3. WHEN a visitor selects a category in the Category_Filter, THE Search_Page SHALL filter displayed results to show only campaigns matching the selected category
4. WHEN a visitor selects a category with an active search query, THE Search_Page SHALL apply both the text search and category filter simultaneously
5. WHEN a visitor clears the Category_Filter selection (clicks "Semua" or deselects), THE Search_Page SHALL display all results matching the current search query without category restriction
6. THE Search_Page SHALL update the URL query parameters to include `category=[slug]` for shareable filtered results
7. WHEN the Search_Page loads with a `category` query parameter in the URL, THE Category_Filter SHALL pre-select the corresponding category and filter results accordingly
8. WHEN a visitor selects a category that yields zero matching campaigns, THE Search_Page SHALL display an empty state message "Tidak ada kampanye ditemukan dalam kategori ini"

### Requirement 8: Footer Component Extraction

**User Story:** As a visitor on any page, I want consistent footer navigation across the site, so that I can access informational and legal pages from anywhere.

#### Acceptance Criteria

1. THE Platform SHALL display the same footer content consistently on all pages where it appears
2. THE Footer SHALL be rendered on desktop viewports (≥1024px) on all pages except `/login`, `/register`, `/admin/*`, and `/moderasi/*`
3. THE Footer SHALL NOT be rendered on mobile viewports (<1024px) where the BottomNavBar is displayed
4. THE Footer SHALL contain links to `/about`, `/careers`, `/press`, `/help`, `/faq`, `/contact`, `/terms`, and `/privacy`
5. WHEN a visitor clicks any link in the Footer, THE Platform SHALL navigate to the corresponding static page without a 404 error
6. THE Footer SHALL use Next.js `<Link>` components instead of plain `<a>` tags for client-side navigation
