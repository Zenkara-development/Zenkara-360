-- Adds the cross-org PLATFORM_ADMIN value to the UserRole enum. A user with
-- this role has orgId = NULL (User.orgId is already nullable) and is used
-- exclusively by the new platform-admin module to view/manage license,
-- branding, and sending-connection status across every Organization.
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_ADMIN';
