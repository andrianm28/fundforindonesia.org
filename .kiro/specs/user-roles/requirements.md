# Requirements Document

## Introduction

This document specifies the requirements for adding a Role-Based Access Control (RBAC) system to the Fund for Indonesia (Kitabisa clone) crowdfunding platform. The system introduces four distinct roles — ADMIN, MODERATOR, CAMPAIGN_CREATOR, and DONOR — to control access to features based on a user's assigned role. The current platform treats all authenticated users equally; this feature adds granular permission control for platform management, campaign moderation, campaign creation, and basic donor operations.

## Glossary

- **RBAC_System**: The Role-Based Access Control module responsible for assigning roles, checking permissions, and enforcing access rules across the platform.
- **Role**: A named set of permissions assigned to a user that determines what actions the user can perform. Valid roles are ADMIN, MODERATOR, CAMPAIGN_CREATOR, and DONOR.
- **Permission**: A specific action or access right granted to a role (e.g., "manage_users", "review_campaigns", "create_campaign", "donate").
- **Admin_Dashboard**: The administrative interface accessible only to users with the ADMIN role for full platform management.
- **Moderation_Panel**: The interface accessible to users with the MODERATOR role for reviewing campaigns and managing reports.
- **Auth_Middleware**: The Next.js middleware layer responsible for intercepting requests and enforcing role-based access on protected routes.
- **Session_Token**: The JWT token containing user identity and role information used for authentication and authorization.
- **Role_Assignment**: The process of assigning or changing a user's role in the system.
- **Default_Role**: The DONOR role automatically assigned to newly registered users.

## Requirements

### Requirement 1: Role Data Model

**User Story:** As a platform developer, I want a persistent role field on the User model, so that each user's access level is stored and retrievable.

#### Acceptance Criteria

1. THE RBAC_System SHALL store a role field on each User record with one of the following values: ADMIN, MODERATOR, CAMPAIGN_CREATOR, or DONOR.
2. WHEN a new user registers, THE RBAC_System SHALL assign the DONOR role as the Default_Role regardless of any system-wide configuration.
3. THE RBAC_System SHALL enforce that every User record contains exactly one valid role value at all times.

### Requirement 2: Role Inclusion in Session

**User Story:** As a platform developer, I want the user's role included in the session token, so that role checks can be performed without additional database queries on every request.

#### Acceptance Criteria

1. WHEN a user authenticates successfully, THE RBAC_System SHALL include the user's current role in the Session_Token.
2. WHEN a user's role is changed by an administrator, THE RBAC_System SHALL update the role in the Session_Token on the next session refresh.
3. THE RBAC_System SHALL expose the user's role in the session object accessible to both server components and API routes.
4. IF role exposure cannot be initialized at startup, THE RBAC_System SHALL allow the system to start and handle missing roles gracefully in components by defaulting to DONOR-level access.

### Requirement 3: Admin Access Control

**User Story:** As an administrator, I want exclusive access to platform management features, so that I can manage users, campaigns, and platform settings.

#### Acceptance Criteria

1. WHILE a user has the ADMIN role, THE Auth_Middleware SHALL allow access to the Admin_Dashboard routes.
2. WHEN a user without the ADMIN role attempts to access Admin_Dashboard routes, THE Auth_Middleware SHALL redirect the user to the home page.
3. WHILE a user has the ADMIN role, THE RBAC_System SHALL allow the user to perform Role_Assignment for other users.
4. WHILE a user has the ADMIN role, THE RBAC_System SHALL allow the user to view, edit, and delete any campaign on the platform.
5. WHILE a user has the ADMIN role, THE RBAC_System SHALL allow the user to view all registered users and their details.

### Requirement 4: Moderator Access Control

**User Story:** As a moderator, I want access to campaign review and report management features, so that I can ensure platform content quality.

#### Acceptance Criteria

1. WHILE a user has the MODERATOR role, THE Auth_Middleware SHALL allow access to the Moderation_Panel routes.
2. WHEN a user without the MODERATOR or ADMIN role attempts to access Moderation_Panel routes, THE Auth_Middleware SHALL redirect the user to the home page.
3. WHILE a user has the MODERATOR role, THE RBAC_System SHALL allow the user to approve, reject, or suspend campaigns.
4. WHILE a user has the MODERATOR role, THE RBAC_System SHALL allow the user to view campaign reports submitted by other users.
5. WHILE a user has the MODERATOR role, THE RBAC_System SHALL prevent the user from performing Role_Assignment operations.

### Requirement 5: Campaign Creator Access Control

**User Story:** As a verified user, I want the ability to create and manage campaigns, so that I can raise funds for causes I support.

#### Acceptance Criteria

1. WHEN a user's verification is approved, THE RBAC_System SHALL upgrade the user's role from DONOR to CAMPAIGN_CREATOR.
2. WHILE a user has the CAMPAIGN_CREATOR role, THE Auth_Middleware SHALL allow access to the campaign creation routes.
3. WHEN a user with the DONOR role attempts to access campaign creation routes, THE Auth_Middleware SHALL redirect the user to the verification page.
4. WHILE a user has the CAMPAIGN_CREATOR role, THE RBAC_System SHALL allow the user to create new campaigns.
5. WHILE a user has the CAMPAIGN_CREATOR role, THE RBAC_System SHALL allow the user to edit and manage only campaigns where the user is the creator.

### Requirement 6: Donor Access Control

**User Story:** As a donor, I want to browse campaigns and make donations, so that I can contribute to causes I care about.

#### Acceptance Criteria

1. WHILE a user has the DONOR role, THE RBAC_System SHALL allow the user to view campaign listings and campaign details.
2. WHILE a user has the DONOR role, THE RBAC_System SHALL allow the user to make donations to active campaigns.
3. WHILE a user has the DONOR role, THE RBAC_System SHALL allow the user to view their own donation history.
4. WHILE a user has the DONOR role, THE RBAC_System SHALL prevent the user from creating campaigns.
5. WHILE a user has the DONOR role, THE RBAC_System SHALL prevent the user from accessing Admin_Dashboard or Moderation_Panel routes.

### Requirement 7: Role Hierarchy and Inheritance

**User Story:** As a platform architect, I want higher roles to inherit lower role permissions, so that admins and moderators can still use basic platform features.

#### Acceptance Criteria

1. THE RBAC_System SHALL grant ADMIN role all permissions available to MODERATOR, CAMPAIGN_CREATOR, and DONOR roles.
2. THE RBAC_System SHALL grant MODERATOR role all permissions available to CAMPAIGN_CREATOR and DONOR roles.
3. THE RBAC_System SHALL grant CAMPAIGN_CREATOR role all permissions available to DONOR role.
4. THE RBAC_System SHALL enforce the role hierarchy as: ADMIN > MODERATOR > CAMPAIGN_CREATOR > DONOR.

### Requirement 8: Role-Based API Protection

**User Story:** As a platform developer, I want API routes protected by role checks, so that unauthorized users cannot bypass the UI to perform restricted actions.

#### Acceptance Criteria

1. WHEN an API request is received for a protected endpoint, THE RBAC_System SHALL verify the requesting user's role against the endpoint's required role and automatically deny access when verification fails.
2. WHEN a user's role does not satisfy the required role for an API endpoint, THE RBAC_System SHALL return an HTTP 403 Forbidden response with an error message.
3. WHEN an unauthenticated request is received for a protected API endpoint, THE RBAC_System SHALL return an HTTP 401 Unauthorized response.
4. THE RBAC_System SHALL apply role checks to campaign management APIs, user management APIs, and moderation APIs.
5. IF a system error occurs during role verification, THE RBAC_System SHALL return an HTTP 500 Internal Server Error response rather than HTTP 403.

### Requirement 9: Role Management by Admin

**User Story:** As an administrator, I want to assign and change user roles, so that I can grant appropriate access levels to platform team members.

#### Acceptance Criteria

1. WHEN an administrator assigns a new role to a user, THE RBAC_System SHALL update the user's role in the database.
2. WHEN an administrator attempts to change a role, THE RBAC_System SHALL validate that the target role is a valid role value.
3. THE RBAC_System SHALL prevent non-ADMIN users from performing Role_Assignment operations under all circumstances, including when zero administrators exist in the system.
4. WHEN a role change is performed, THE RBAC_System SHALL create a notification for the affected user indicating their role has changed.
5. THE RBAC_System SHALL prevent any administrator from removing the ADMIN role from their own account.

### Requirement 10: Backward Compatibility

**User Story:** As a platform developer, I want the role system to be backward compatible with existing users, so that no existing functionality breaks during migration.

#### Acceptance Criteria

1. WHEN the role migration runs, THE RBAC_System SHALL check each user's current verification status dynamically and assign the DONOR role to users who are not verified.
2. WHEN the role migration runs, THE RBAC_System SHALL check each user's current verification status dynamically and assign the CAMPAIGN_CREATOR role to users who have isVerified set to true.
3. THE RBAC_System SHALL maintain existing protected route behavior for authenticated users while adding role-based restrictions on top.
4. THE RBAC_System SHALL preserve the existing campaign creator ownership check (creatorId) as an additional authorization layer alongside role checks.
