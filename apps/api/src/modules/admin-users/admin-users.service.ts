import { Prisma } from "@prisma/client";

import { hashPassword } from "../auth/password.js";
import {
    assertPasswordPolicy,
    isPrivilegedRoleList,
    PasswordPolicyError,
} from "../auth/password-policy.js";
import {
    AdminUsersRepository,
    type UserAuditRow,
    type UserDetailRow,
    type UserListFilters,
    type UserListRow,
} from "./admin-users.repo.js";

export class AdminUsersError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "AdminUsersError";
    }
}

export type AdminActor = {
    publicId: string;
    roles: string[];
    ipAddress: string | null;
    userAgent: string | null;
};

const PRIVILEGED_ROLES = new Set(["admin", "super_admin"]);
const MANAGED_ROLES = new Set(["user", "viewer", "surveyor", "admin", "super_admin"]);

function isPrivilegedRole(code: string): boolean {
    return PRIVILEGED_ROLES.has(code);
}

function isSuperAdmin(actor: AdminActor): boolean {
    return actor.roles.includes("super_admin");
}

export type AdminUserListItem = {
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    email_verified: boolean;
    account_status: string;
    primary_region_id: string | null;
    roles: string[];
    total_points: number;
    last_seen_at: string | null;
    last_login_at: string | null;
    created_at: string;
};

export type UserAuditEntry = {
    id: string;
    action_type: string;
    actor_display_name: string | null;
    before_snapshot: unknown;
    after_snapshot: unknown;
    created_at: string;
};

export type AdminUserDetail = AdminUserListItem & {
    is_active: boolean;
    preferred_language: string;
    admin_note: string | null;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    saved_places_count: number;
    updated_at: string;
    deleted_at: string | null;
};

export class AdminUsersService {
    constructor(private readonly repo: AdminUsersRepository) {}

    async createUser(
        actor: AdminActor,
        input: {
            email: string;
            displayName: string;
            password: string;
            roleCode: string;
        }
    ): Promise<AdminUserDetail> {
        if (!isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can create accounts", 403);
        }
        if (!MANAGED_ROLES.has(input.roleCode)) {
            throw new AdminUsersError("Unknown role", 400);
        }

        const email = input.email.trim().toLowerCase();
        const displayName = input.displayName.trim();
        this.assertManagedPassword(input.password, isPrivilegedRole(input.roleCode));

        if ((await this.repo.findUserIdByEmail(email)) !== null) {
            throw new AdminUsersError("Email already registered", 409);
        }

        const roleId = await this.repo.findRoleIdByCode(input.roleCode);
        if (roleId === null) {
            throw new AdminUsersError("Role is not configured", 500);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        try {
            const publicId = await this.repo.createUser({
                email,
                displayName,
                passwordHash: await hashPassword(input.password),
                roleId,
                roleCode: input.roleCode,
                actorUserId,
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
            });
            return this.getUserDetail(publicId);
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new AdminUsersError("Email already registered", 409);
            }
            throw error;
        }
    }

    async listUsers(filters: UserListFilters): Promise<{
        items: AdminUserListItem[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const { items, total } = await this.repo.listUsers(filters);
        return {
            items: items.map(toListItem),
            total,
            page: filters.page,
            pageSize: filters.pageSize,
        };
    }

    async getUserDetail(publicId: string): Promise<AdminUserDetail> {
        const row = await this.repo.getUserDetail(publicId);
        if (!row) {
            throw new AdminUsersError("User not found", 404);
        }
        return toDetail(row);
    }

    async getUserAudit(publicId: string, limit: number): Promise<UserAuditEntry[]> {
        const target = await this.repo.getManageableUser(publicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }
        const rows = await this.repo.listUserAudit(target.id, limit);
        return rows.map(toAuditEntry);
    }

    async updateProfile(
        actor: AdminActor,
        targetPublicId: string,
        fields: {
            email?: string;
            displayName?: string;
            phone?: string | null;
            preferredLanguage?: "my" | "en";
            primaryRegionId?: number | null;
            emailVerified?: boolean;
        }
    ): Promise<AdminUserDetail> {
        if (!isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can edit account profiles", 403);
        }

        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }

        const email = fields.email?.trim().toLowerCase();
        if (email && email !== target.email) {
            const emailOwnerId = await this.repo.findUserIdByEmail(email);
            if (emailOwnerId !== null && emailOwnerId !== target.id) {
                throw new AdminUsersError("Email already registered", 409);
            }
        }

        let primaryRegionId: bigint | null | undefined;
        if (fields.primaryRegionId !== undefined) {
            primaryRegionId =
                fields.primaryRegionId === null ? null : BigInt(fields.primaryRegionId);
            if (
                primaryRegionId !== null &&
                !(await this.repo.adminAreaExists(primaryRegionId))
            ) {
                throw new AdminUsersError(
                    "primaryRegionId does not reference a known region",
                    400
                );
            }
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        try {
            await this.repo.updateProfile({
                target,
                fields: {
                    ...(email !== undefined ? { email } : {}),
                    ...(fields.displayName !== undefined
                        ? { displayName: fields.displayName.trim() }
                        : {}),
                    ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
                    ...(fields.preferredLanguage !== undefined
                        ? { preferredLanguage: fields.preferredLanguage }
                        : {}),
                    ...(primaryRegionId !== undefined ? { primaryRegionId } : {}),
                    ...(fields.emailVerified !== undefined
                        ? { emailVerified: fields.emailVerified }
                        : {}),
                },
                actorUserId,
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new AdminUsersError("Email already registered", 409);
            }
            throw error;
        }

        return this.getUserDetail(targetPublicId);
    }

    async resetPassword(
        actor: AdminActor,
        targetPublicId: string,
        password: string
    ): Promise<void> {
        if (!isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can reset passwords", 403);
        }

        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }
        this.assertManagedPassword(password, isPrivilegedRoleList(target.roles));

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        await this.repo.resetPassword({
            target,
            passwordHash: await hashPassword(password),
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });
    }

    async updateStatus(
        actor: AdminActor,
        targetPublicId: string,
        accountStatus: string
    ): Promise<AdminUserDetail> {
        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        if (actorUserId !== null && actorUserId === target.id) {
            throw new AdminUsersError("You cannot change your own account status", 400);
        }

        if (accountStatus === "deleted" && !isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can delete users", 403);
        }

        if (target.roles.some(isPrivilegedRole) && !isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can modify admin accounts", 403);
        }

        if (target.account_status !== accountStatus) {
            await this.repo.updateStatus({
                targetUserId: target.id,
                accountStatus,
                beforeStatus: target.account_status,
                actorUserId,
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
            });
        }

        return this.getUserDetail(targetPublicId);
    }

    async updateAdminNote(
        actor: AdminActor,
        targetPublicId: string,
        adminNote: string | null
    ): Promise<AdminUserDetail> {
        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }

        const detailBefore = await this.repo.getUserDetail(targetPublicId);
        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);

        await this.repo.updateAdminNote({
            targetUserId: target.id,
            adminNote,
            beforeNote: detailBefore?.admin_note ?? null,
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });

        return this.getUserDetail(targetPublicId);
    }

    async assignRole(
        actor: AdminActor,
        targetPublicId: string,
        roleCode: string
    ): Promise<AdminUserDetail> {
        if (isPrivilegedRole(roleCode) && !isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can assign admin roles", 403);
        }

        const roleId = await this.repo.findRoleIdByCode(roleCode);
        if (roleId === null) {
            throw new AdminUsersError("Unknown role", 400);
        }

        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);

        await this.repo.assignRole({
            targetUserId: target.id,
            roleId,
            roleCode,
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });

        return this.getUserDetail(targetPublicId);
    }

    async removeRole(
        actor: AdminActor,
        targetPublicId: string,
        roleCode: string
    ): Promise<AdminUserDetail> {
        if (isPrivilegedRole(roleCode) && !isSuperAdmin(actor)) {
            throw new AdminUsersError("Only super_admin can remove admin roles", 403);
        }

        const roleId = await this.repo.findRoleIdByCode(roleCode);
        if (roleId === null) {
            throw new AdminUsersError("Unknown role", 400);
        }

        const target = await this.repo.getManageableUser(targetPublicId);
        if (!target) {
            throw new AdminUsersError("User not found", 404);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        if (actorUserId !== null && actorUserId === target.id && isPrivilegedRole(roleCode)) {
            throw new AdminUsersError("You cannot remove your own privileged role", 400);
        }

        const removed = await this.repo.removeRole({
            targetUserId: target.id,
            roleId,
            roleCode,
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });

        if (!removed) {
            throw new AdminUsersError("User does not have this role", 404);
        }

        return this.getUserDetail(targetPublicId);
    }

    private assertManagedPassword(password: string, privileged: boolean): void {
        try {
            assertPasswordPolicy(password, { privileged });
        } catch (error) {
            if (error instanceof PasswordPolicyError) {
                throw new AdminUsersError(error.message, 400);
            }
            throw error;
        }
    }
}

function isUniqueViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return error.code === "P2002";
    }
    return /unique|duplicate key/i.test(error instanceof Error ? error.message : String(error));
}

function bigintToString(value: bigint | null): string | null {
    return value !== null ? value.toString() : null;
}

function isoOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function toListItem(row: UserListRow): AdminUserListItem {
    return {
        public_id: row.public_id,
        email: row.email,
        display_name: row.display_name,
        phone: row.phone,
        email_verified: row.email_verified,
        account_status: row.account_status,
        primary_region_id: bigintToString(row.primary_region_id),
        roles: row.roles,
        total_points: row.total_points,
        last_seen_at: isoOrNull(row.last_seen_at),
        last_login_at: isoOrNull(row.last_login_at),
        created_at: row.created_at.toISOString(),
    };
}

function toAuditEntry(row: UserAuditRow): UserAuditEntry {
    return {
        id: row.id.toString(),
        action_type: row.action_type,
        actor_display_name: row.actor_display_name,
        before_snapshot: row.before_snapshot ?? null,
        after_snapshot: row.after_snapshot ?? null,
        created_at: row.created_at.toISOString(),
    };
}

function toDetail(row: UserDetailRow): AdminUserDetail {
    return {
        ...toListItem(row),
        is_active: row.is_active,
        preferred_language: row.preferred_language,
        admin_note: row.admin_note,
        lifetime_points_earned: row.lifetime_points_earned,
        lifetime_points_removed: row.lifetime_points_removed,
        saved_places_count: row.saved_places_count,
        updated_at: row.updated_at.toISOString(),
        deleted_at: isoOrNull(row.deleted_at),
    };
}
