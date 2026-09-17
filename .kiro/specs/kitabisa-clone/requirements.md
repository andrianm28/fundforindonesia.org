# Requirements Document

## Introduction

This document defines the requirements for a pixel-perfect clone of kitabisa.com, Indonesia's leading crowdfunding and donation platform. The clone will replicate the core user experience including campaign discovery, campaign details, donation flow, user authentication, and responsive design matching the original platform's visual fidelity.

## Glossary

- **Platform**: The kitabisa.com clone web application
- **Campaign**: A fundraising initiative created by a Campaign_Creator with a target amount, deadline, and story
- **Donor**: A registered or anonymous user who contributes money to a Campaign
- **Campaign_Creator**: A verified user who creates and manages a Campaign
- **Campaign_Card**: A UI component displaying Campaign summary (image, title, creator, progress bar, amount collected, days remaining)
- **Progress_Bar**: A visual indicator showing the percentage of funds raised relative to the target amount
- **Navigation_Bar**: The bottom navigation component with Home, Donasi, Galang Dana, Donasi Saya, and Akun tabs
- **Category**: A classification for Campaigns (e.g., Bencana Alam, Balita & Anak Sakit, Bantuan Medis & Kesehatan)
- **Prayer_Wall**: A feed of prayers/messages left by Donors alongside their donations
- **Donation_Flow**: The multi-step process from selecting a donation amount through payment confirmation
- **Verification_Badge**: An icon indicating a Campaign_Creator's identity has been verified

## Requirements

### Requirement 1: Homepage Layout and Hero Section

**User Story:** As a Donor, I want to see a welcoming homepage with featured campaigns and quick-action tiles, so that I can quickly find causes to support.

#### Acceptance Criteria

1. THE Platform SHALL display a hero banner section with a promotional image, headline text, and call-to-action buttons
2. THE Platform SHALL display a grid of quick-action tiles (Donasi, Zakat, Galang Dana, Donasi Otomatis, Kitabisa Experience, Kolaborasi CSR, Asuransi SalingJaga) below the hero section
3. THE Platform SHALL display a "Penggalangan Dana Mendesak" (Urgent Fundraising) section showing a horizontally scrollable list of urgent Campaign_Cards
4. THE Platform SHALL display a "Yang Baru di Kitabisa" (What's New) section with a carousel of campaign banners
5. THE Platform SHALL display a "Program Donasi Berkelanjutan" (Ongoing Donation Programs) section with Campaign_Cards
6. THE Platform SHALL display a "Pilihan Kitabisa" (Kitabisa's Picks) section with a grid of Campaign_Cards showing up to 12 campaigns
7. THE Platform SHALL display a "Pilih Kategori Favoritmu" (Choose Your Favorite Category) section with category icons and corresponding Campaign_Cards
8. THE Platform SHALL display a "Doa-doa #OrangBaik" (Prayers from Good People) section showing a live feed of recent prayers from Donors
9. THE Platform SHALL display a footer section with About, Terms & Conditions, Help Center links, and social media icons

### Requirement 2: Bottom Navigation Bar

**User Story:** As a Donor, I want a persistent navigation bar at the bottom of the screen, so that I can easily switch between main sections of the application.

#### Acceptance Criteria

1. THE Navigation_Bar SHALL display five tabs: Home (Donasi), Galang Dana, Donasi Saya, Inbox, and Akun
2. THE Navigation_Bar SHALL highlight the currently active tab with a distinct color
3. THE Navigation_Bar SHALL remain fixed at the bottom of the viewport on mobile views
4. WHEN a user taps a Navigation_Bar tab, THE Platform SHALL navigate to the corresponding section

### Requirement 3: Campaign Card Display

**User Story:** As a Donor, I want to see campaign information at a glance on each card, so that I can decide which campaigns interest me.

#### Acceptance Criteria

1. THE Campaign_Card SHALL display the campaign cover image at the top
2. THE Campaign_Card SHALL display the campaign title below the image
3. THE Campaign_Card SHALL display the Campaign_Creator name with a Verification_Badge when applicable
4. THE Campaign_Card SHALL display a Progress_Bar showing percentage of target amount raised
5. THE Campaign_Card SHALL display the amount collected formatted in Indonesian Rupiah (e.g., "Rp25.841.000")
6. THE Campaign_Card SHALL display either "Terkumpul" (Collected) or "Tersedia" (Available) label preceding the amount
7. WHEN a campaign has a deadline, THE Campaign_Card SHALL display the remaining days (e.g., "61 hari lagi")
8. WHEN a user taps a Campaign_Card, THE Platform SHALL navigate to the Campaign detail page

### Requirement 4: Campaign Detail Page

**User Story:** As a Donor, I want to see comprehensive campaign information, so that I can make an informed donation decision.

#### Acceptance Criteria

1. THE Platform SHALL display the campaign cover image at full width at the top of the page
2. THE Platform SHALL display the campaign title as a heading below the image
3. THE Platform SHALL display the amount collected, target amount, remaining days, and total donation count
4. THE Platform SHALL display a Progress_Bar showing fundraising progress
5. THE Platform SHALL display tab navigation for "Kabar Terbaru" (Latest News), "Pencairan Dana" (Fund Disbursement), and campaign story
6. THE Platform SHALL display Campaign_Creator information with name, Verification_Badge, and identity verification details
7. THE Platform SHALL display the full campaign story with formatted text and embedded images
8. THE Platform SHALL display a "Kabar Terbaru" section showing campaign updates from the Campaign_Creator
9. THE Platform SHALL display a "Pencairan Dana" section showing fund disbursement records
10. THE Platform SHALL display a "Donasi" section showing the total donation count
11. THE Platform SHALL display a "Doa-doa Orang Baik" section listing prayers from Donors with timestamps and "Aamiin" interaction
12. THE Platform SHALL display a fixed "Donasi sekarang" (Donate Now) button at the bottom of the page
13. THE Platform SHALL display a share button allowing users to share the campaign

### Requirement 5: Campaign Categories and Explore Page

**User Story:** As a Donor, I want to browse campaigns by category, so that I can find causes aligned with my interests.

#### Acceptance Criteria

1. THE Platform SHALL display a category selection interface with icons for each Category (Bencana Alam, Balita & Anak Sakit, Bantuan Medis & Kesehatan, and others)
2. WHEN a user selects a Category, THE Platform SHALL display a filtered list of Campaign_Cards belonging to that Category
3. THE Platform SHALL display an explore page (/explore/all) listing all campaigns with infinite scroll or pagination
4. THE Platform SHALL display each campaign in the explore list with title, Campaign_Creator name, Verification_Badge, amount collected, and remaining days
5. THE Platform SHALL provide a search functionality accessible from the top of the page with a search bar

### Requirement 6: Donation Flow

**User Story:** As a Donor, I want a simple and secure donation process, so that I can contribute to campaigns quickly.

#### Acceptance Criteria

1. WHEN a user taps "Donasi sekarang", THE Platform SHALL navigate to a donation amount selection page
2. THE Donation_Flow SHALL display preset donation amount options (e.g., Rp10.000, Rp25.000, Rp50.000, Rp100.000, Rp500.000)
3. THE Donation_Flow SHALL allow users to input a custom donation amount
4. THE Donation_Flow SHALL display available payment methods (bank transfer, e-wallet, credit card)
5. WHEN a user selects a payment method and confirms, THE Platform SHALL create a donation record and display payment instructions
6. THE Donation_Flow SHALL allow Donors to leave a prayer/message with their donation
7. THE Donation_Flow SHALL allow Donors to choose anonymous donation
8. IF a Donor enters an amount below the minimum threshold, THEN THE Platform SHALL display a validation error with the minimum amount required

### Requirement 7: User Authentication

**User Story:** As a user, I want to create an account and log in, so that I can track my donations and manage my profile.

#### Acceptance Criteria

1. THE Platform SHALL provide a registration flow with email, name, and password fields
2. THE Platform SHALL provide a login flow with email and password
3. THE Platform SHALL support social login options (Google)
4. WHEN a user successfully authenticates, THE Platform SHALL redirect to the homepage with the user's session active
5. THE Platform SHALL display user profile information in the "Akun" (Account) tab
6. IF a user enters invalid credentials, THEN THE Platform SHALL display a descriptive error message
7. THE Platform SHALL allow Donors to donate without creating an account (as anonymous)

### Requirement 8: Donation Tracking (Donasi Saya)

**User Story:** As a Donor, I want to see my donation history, so that I can track my contributions and follow campaign updates.

#### Acceptance Criteria

1. THE Platform SHALL display a "Donasi Saya" (My Donations) page listing all donations made by the authenticated Donor
2. THE Platform SHALL display each donation record with campaign title, amount donated, date, and payment status
3. WHEN a user taps a donation record, THE Platform SHALL navigate to the corresponding Campaign detail page

### Requirement 9: Prayer Wall (Doa-doa OrangBaik)

**User Story:** As a Donor, I want to see and interact with prayers from other donors, so that I feel part of a supportive community.

#### Acceptance Criteria

1. THE Prayer_Wall SHALL display prayers in reverse chronological order with Donor name (or "Anonim"), timestamp, associated campaign link, and prayer text
2. THE Prayer_Wall SHALL display the number of people who have said "Aamiin" to each prayer
3. WHEN a user taps "Aamiin" on a prayer, THE Platform SHALL increment the aamiin count and provide visual feedback
4. THE Prayer_Wall SHALL display the Donor's avatar (or default anonymous avatar) alongside each prayer

### Requirement 10: Responsive Design

**User Story:** As a user, I want the platform to work seamlessly on mobile and desktop, so that I can donate from any device.

#### Acceptance Criteria

1. THE Platform SHALL render a mobile-first layout optimized for viewports 320px to 480px wide
2. THE Platform SHALL adapt the layout for tablet viewports (481px to 1024px) with appropriate spacing and grid adjustments
3. THE Platform SHALL adapt the layout for desktop viewports (1025px and above) with a centered content container and maximum width constraint
4. THE Platform SHALL display the Navigation_Bar only on mobile and tablet viewports
5. THE Platform SHALL display a top header navigation on desktop viewports
6. THE Platform SHALL maintain visual fidelity with kitabisa.com's color scheme (primary blue #0073E6, accent orange, white backgrounds, gray text)
7. THE Platform SHALL use the same typography hierarchy as kitabisa.com (sans-serif font family, consistent heading and body sizes)

### Requirement 11: Campaign Creation (Galang Dana)

**User Story:** As a Campaign_Creator, I want to create a fundraising campaign, so that I can raise funds for my cause.

#### Acceptance Criteria

1. WHEN a user navigates to Galang Dana, THE Platform SHALL display a campaign creation form
2. THE Platform SHALL require a campaign title, target amount, deadline, category, cover image, and campaign story
3. THE Platform SHALL require Campaign_Creator identity verification (KYC) before publishing a campaign
4. WHEN a Campaign_Creator submits a valid campaign form, THE Platform SHALL create the campaign and display a confirmation
5. IF required fields are missing, THEN THE Platform SHALL display validation errors indicating which fields need to be completed

### Requirement 12: Campaign Updates and Disbursement

**User Story:** As a Donor, I want to receive updates on campaigns I've donated to, so that I can see how my donation is being used.

#### Acceptance Criteria

1. THE Platform SHALL allow Campaign_Creators to post text and image updates to their Campaign's "Kabar Terbaru" section
2. THE Platform SHALL display fund disbursement records showing when and how funds were released to the Campaign_Creator
3. THE Platform SHALL display campaign updates with a timestamp and formatted content
4. WHEN a campaign has new updates, THE Platform SHALL indicate the update in the Donor's inbox

### Requirement 13: Search Functionality

**User Story:** As a Donor, I want to search for campaigns by keyword, so that I can find specific causes I care about.

#### Acceptance Criteria

1. THE Platform SHALL provide a search input accessible from the homepage header
2. WHEN a user enters a search query, THE Platform SHALL display matching campaigns based on title and description keywords
3. THE Platform SHALL display search results as a list of Campaign_Cards
4. IF no campaigns match the search query, THEN THE Platform SHALL display an empty state message

### Requirement 14: Internationalization and Currency Formatting

**User Story:** As a user, I want the platform to display content in Indonesian with proper currency formatting, so that I can understand all information clearly.

#### Acceptance Criteria

1. THE Platform SHALL display all UI text in Bahasa Indonesia
2. THE Platform SHALL format currency values in Indonesian Rupiah with "Rp" prefix and period as thousands separator (e.g., "Rp25.841.000")
3. THE Platform SHALL format dates in Indonesian locale (e.g., "06 Jun 2026")
4. THE Platform SHALL display relative timestamps in Indonesian (e.g., "15 menit yang lalu", "61 hari lagi")

### Requirement 15: Zakat Donation

**User Story:** As a Muslim Donor, I want to calculate and pay my Zakat through the platform, so that I can fulfill my religious obligation conveniently.

#### Acceptance Criteria

1. THE Platform SHALL provide a dedicated Zakat section accessible from the homepage quick-action tiles
2. THE Platform SHALL display Zakat campaign options (Zakat Mal, Zakat Fitrah, Infaq, Sedekah)
3. THE Platform SHALL provide a Zakat calculator to help Donors determine the correct Zakat amount based on their assets
4. WHEN a user completes the Zakat calculation, THE Platform SHALL allow the Donor to proceed to the Donation_Flow with the calculated amount
5. THE Platform SHALL display verified Zakat distribution organizations as Campaign_Creators

### Requirement 16: Automatic/Recurring Donations (Donasi Otomatis)

**User Story:** As a Donor, I want to set up automatic daily donations, so that I can give regularly without manual effort.

#### Acceptance Criteria

1. THE Platform SHALL provide a Donasi Otomatis section accessible from the homepage quick-action tiles
2. THE Platform SHALL allow Donors to set a daily donation amount from a pre-funded balance (Donation Pocket)
3. THE Platform SHALL allow Donors to choose donation categories for automatic distribution
4. THE Platform SHALL allow Donors to set preferred donation times (e.g., morning/Subuh donations)
5. THE Platform SHALL process automatic donations at the Donor's configured schedule
6. WHEN a Donor's balance is insufficient, THE Platform SHALL notify the Donor and pause automatic donations

### Requirement 17: Inbox and Notifications

**User Story:** As a Donor, I want to receive notifications about campaigns I follow and donations I've made, so that I stay informed about the impact of my contributions.

#### Acceptance Criteria

1. THE Platform SHALL display an Inbox section accessible from the Navigation_Bar
2. THE Platform SHALL show notifications for campaign updates on campaigns the Donor has contributed to
3. THE Platform SHALL show notifications for donation confirmations and payment status changes
4. THE Platform SHALL show notifications for new "Kabar Terbaru" posts from campaigns the Donor follows
5. WHEN a new notification arrives, THE Platform SHALL display an unread indicator badge on the Inbox tab

### Requirement 18: Social Sharing

**User Story:** As a Donor or Campaign_Creator, I want to share campaigns on social media, so that I can help spread awareness and attract more donations.

#### Acceptance Criteria

1. THE Platform SHALL provide share functionality on each Campaign detail page
2. THE Platform SHALL support sharing via WhatsApp, Facebook, Twitter, and copy-link
3. WHEN a user taps the share button, THE Platform SHALL display a share modal with available sharing options
4. THE Platform SHALL generate a shareable link with campaign metadata (title, image, description) for social media previews

### Requirement 19: Campaign Verification and Trust Indicators

**User Story:** As a Donor, I want to see verification levels for campaign creators, so that I can trust that my donation reaches legitimate causes.

#### Acceptance Criteria

1. THE Platform SHALL display identity verification status on each Campaign_Creator's profile
2. THE Platform SHALL show a Verification_Badge with tooltip explaining the verification type (KTP-based identity verification for individuals, organizational document verification for organizations)
3. THE Platform SHALL display "Identitas terverifikasi" (Identity Verified) label for verified Campaign_Creators
4. THE Platform SHALL distinguish between individual Campaign_Creators and organizational Campaign_Creators with different verification indicators

### Requirement 20: Donation Pocket / Balance System

**User Story:** As a Donor, I want to top up a donation balance, so that I can use it for quick donations and automatic giving.

#### Acceptance Criteria

1. THE Platform SHALL provide a Donation Pocket (Saldo) feature allowing Donors to pre-fund a balance
2. THE Platform SHALL allow Donors to top up their Donation Pocket via available payment methods
3. THE Platform SHALL allow Donors to use their Donation Pocket balance for one-tap donations
4. THE Platform SHALL display the current Donation Pocket balance in the Account section
5. WHEN a Donor donates using the Donation Pocket, THE Platform SHALL deduct the amount immediately and confirm the donation
