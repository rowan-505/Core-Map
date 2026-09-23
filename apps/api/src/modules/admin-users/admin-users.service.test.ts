import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AdminUsersRepository,
    type ManageableUser,
    type UserDetailRow,
} from "./admin-users.repo.js";
import {
    AdminUsersError,
    AdminUsersService,
    type AdminActor,
} from "./admin-users.service.js";

const USER_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_PUBLIC_ID = "22222222-2222-4222-8222-222222222222";

const superAdminActor: AdminActor = {
    publicId: ACTOR_PUBLIC_ID,
    roles: ["super_admin"],
    ipAddress: "127.0.0.1",
    userAgent: "test",
};

const adminActor: AdminActor = {
    ...superAdminActor,
    roles: ["admin"],
};

const detailRow: UserDetailRow = {
    public_id: USER_PUBLIC_ID,
    email: "new.user@example.com",
    display_name: "New User",
    phone: null,
    email_verified: true,
    account_status: "active",
    primary_region_id: null,
    roles: ["viewer"],
    total_points: 0,
    last_seen_at: null,
    last_login_at: null,
    created_at: new Date("2026-09-23T00:00:00Z"),
    is_active: true,
    preferred_language: "my",
    admin_note: null,
    lifetime_points_earned: 0,
    lifetime_points_removed: 0,
    saved_places_count: 0,
    updated_at: new Date("2026-09-23T00:00:00Z"),
    deleted_at: null,
};

const manageableUser: ManageableUser = {
    id: 10n,
    public_id: USER_PUBLIC_ID,
    email: detailRow.email,
    email_verified: true,
    account_status: "active",
    roles: ["viewer"],
    deleted_at: null,
};

class FakeAdminUsersRepository {
    duplicateUserId: bigint | null = null;
    createdInput: Record<string, unknown> | null = null;
    profileInput: Record<string, unknown> | null = null;
    resetInput: Record<string, unknown> | null = null;

    async findUserIdByEmail(): Promise<bigint | null> {
        return this.duplicateUserId;
    }

    async findRoleIdByCode(): Promise<bigint | null> {
        return 7n;
    }

    async findUserIdByPublicId(): Promise<bigint | null> {
        return 99n;
    }

    async createUser(input: Record<string, unknown>): Promise<string> {
        this.createdInput = input;
        return USER_PUBLIC_ID;
    }

    async getUserDetail(): Promise<UserDetailRow> {
        return detailRow;
    }

    async getManageableUser(): Promise<ManageableUser> {
        return manageableUser;
    }

    async adminAreaExists(): Promise<boolean> {
        return true;
    }

    async updateProfile(input: Record<string, unknown>): Promise<void> {
        this.profileInput = input;
    }

    async resetPassword(input: Record<string, unknown>): Promise<void> {
        this.resetInput = input;
    }
}

function makeService(repo: FakeAdminUsersRepository) {
    return new AdminUsersService(repo as unknown as AdminUsersRepository);
}

function assertAdminError(statusCode: number) {
    return (error: unknown) => {
        assert.ok(error instanceof AdminUsersError);
        assert.equal(error.statusCode, statusCode);
        return true;
    };
}

describe("AdminUsersService account provisioning", () => {
    it("rejects account creation by a regular admin", async () => {
        const service = makeService(new FakeAdminUsersRepository());
        await assert.rejects(
            service.createUser(adminActor, {
                email: "user@example.com",
                displayName: "User",
                password: "valid-password",
                roleCode: "viewer",
            }),
            assertAdminError(403)
        );
    });

    it("creates a verified account input with a password hash", async () => {
        const repo = new FakeAdminUsersRepository();
        const service = makeService(repo);
        const password = "valid-password";

        const created = await service.createUser(superAdminActor, {
            email: " New.User@Example.com ",
            displayName: " New User ",
            password,
            roleCode: "viewer",
        });

        assert.equal(created.public_id, USER_PUBLIC_ID);
        assert.equal(repo.createdInput?.email, "new.user@example.com");
        assert.equal(repo.createdInput?.displayName, "New User");
        assert.equal(repo.createdInput?.roleCode, "viewer");
        assert.notEqual(repo.createdInput?.passwordHash, password);
    });

    it("enforces the privileged 12-character password policy", async () => {
        const service = makeService(new FakeAdminUsersRepository());
        await assert.rejects(
            service.createUser(superAdminActor, {
                email: "admin@example.com",
                displayName: "Admin",
                password: "12345678",
                roleCode: "admin",
            }),
            assertAdminError(400)
        );
    });

    it("returns a conflict for a duplicate email", async () => {
        const repo = new FakeAdminUsersRepository();
        repo.duplicateUserId = 50n;
        const service = makeService(repo);

        await assert.rejects(
            service.createUser(superAdminActor, {
                email: "user@example.com",
                displayName: "User",
                password: "valid-password",
                roleCode: "user",
            }),
            assertAdminError(409)
        );
    });

    it("hashes a manual reset password before repository storage", async () => {
        const repo = new FakeAdminUsersRepository();
        const service = makeService(repo);
        const password = "replacement-password";

        await service.resetPassword(superAdminActor, USER_PUBLIC_ID, password);

        assert.ok(repo.resetInput);
        assert.notEqual(repo.resetInput?.passwordHash, password);
    });

    it("allows only a super admin to edit profiles and reset passwords", async () => {
        const service = makeService(new FakeAdminUsersRepository());

        await assert.rejects(
            service.updateProfile(adminActor, USER_PUBLIC_ID, { displayName: "Changed" }),
            assertAdminError(403)
        );
        await assert.rejects(
            service.resetPassword(adminActor, USER_PUBLIC_ID, "replacement-password"),
            assertAdminError(403)
        );
    });

    it("normalizes editable profile data", async () => {
        const repo = new FakeAdminUsersRepository();
        const service = makeService(repo);

        await service.updateProfile(superAdminActor, USER_PUBLIC_ID, {
            email: " Changed@Example.com ",
            displayName: " Changed User ",
            phone: null,
            preferredLanguage: "en",
            primaryRegionId: 5,
            emailVerified: true,
        });

        assert.ok(repo.profileInput);
        const fields = repo.profileInput.fields as Record<string, unknown>;
        assert.equal(fields.email, "changed@example.com");
        assert.equal(fields.displayName, "Changed User");
        assert.equal(fields.primaryRegionId, 5n);
    });
});

describe("AdminUsersRepository account creation audit", () => {
    it("writes an audit entry without password data", async () => {
        const auditCapture: { data?: Record<string, unknown> } = {};
        const tx = {
            authUser: {
                create: async () => ({
                    id: 11n,
                    publicId: USER_PUBLIC_ID,
                    email: "new.user@example.com",
                    displayName: "New User",
                }),
            },
            authIdentity: { create: async () => ({}) },
            authUserRole: { create: async () => ({}) },
            auditLog: {
                create: async ({ data }: { data: Record<string, unknown> }) => {
                    auditCapture.data = data;
                    return {};
                },
            },
        };
        const prisma = {
            $transaction: async (callback: (client: typeof tx) => Promise<string>) =>
                callback(tx),
        };
        const repo = new AdminUsersRepository(prisma as never);

        await repo.createUser({
            email: "new.user@example.com",
            displayName: "New User",
            passwordHash: "secret-hash",
            roleId: 7n,
            roleCode: "viewer",
            actorUserId: 99n,
            ipAddress: "127.0.0.1",
            userAgent: "test",
        });

        const auditData = auditCapture.data;
        assert.ok(auditData);
        assert.equal(auditData?.actionType, "admin_user_created");
        const snapshot = JSON.stringify(auditData?.afterSnapshot);
        assert.equal(snapshot.includes("secret-hash"), false);
        assert.equal(snapshot.includes("passwordHash"), false);
    });
});
