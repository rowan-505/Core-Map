import { hashPassword } from "../modules/auth/password.js";
import { prisma } from "../db/prisma.js";

const EMAIL = "surveyor@coremapmm.com";

function requireTestPassword() {
    const password = process.env.FIELD_E2E_PASSWORD;
    if (!password) throw new Error("FIELD_E2E_PASSWORD is required");
    return password;
}

function requireDisposableDatabase() {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is required");
    const url = new URL(raw);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.pathname !== "/coremap_e2e") {
        throw new Error("Refusing to seed a non-disposable database");
    }
}

async function main() {
    requireDisposableDatabase();
    const passwordHash = await hashPassword(requireTestPassword());
    await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
            INSERT INTO ref.ref_report_types (code, name) VALUES
              ('other_map_issue', 'Other map issue'),
              ('transport_issue', 'Transport issue'),
              ('wrong_location', 'Wrong location'),
              ('missing_item', 'Missing item'),
              ('wrong_info', 'Wrong information')
            ON CONFLICT (code) DO NOTHING
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO ref.ref_report_statuses (code, name)
            VALUES ('submitted', 'Submitted') ON CONFLICT (code) DO NOTHING
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO app_auth.auth_roles (code, name, description)
            VALUES
              ('surveyor', 'Surveyor', 'Test field surveyor'),
              ('admin', 'Admin', 'Test dashboard administrator')
            ON CONFLICT (code) DO NOTHING
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO app_auth.auth_users
              (public_id, email, password_hash, display_name, email_verified, is_active, account_status)
            VALUES
              ('10000000-0000-4000-8000-00000000e001', '${EMAIL}', '${passwordHash}', 'E2E Surveyor', true, true, 'active'),
              ('10000000-0000-4000-8000-00000000e002', 'dashboard-e2e@coremapmm.com', '${passwordHash}', 'E2E Dashboard Admin', true, true, 'active')
            ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
              is_active = true, account_status = 'active', deleted_at = NULL
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO app_auth.auth_user_roles (user_id, role_id)
            SELECT u.id, r.id FROM app_auth.auth_users u JOIN app_auth.auth_roles r ON
              (u.email = '${EMAIL}' AND r.code = 'surveyor') OR
              (u.email = 'dashboard-e2e@coremapmm.com' AND r.code = 'admin')
            ON CONFLICT (user_id, role_id) DO NOTHING
        `);
        await tx.$executeRawUnsafe(`
            WITH route AS (
              INSERT INTO transport.routes
                (public_id, route_code, public_name, mode, route_kind, confidence_score, review_status, is_active)
              VALUES ('20000000-0000-4000-8000-00000000e001', 'YBS-E2E', 'E2E Survey Route',
                      'bus', 'urban_bus', 100, 'verified', true)
              ON CONFLICT (public_id) DO UPDATE SET is_active = true, deleted_at = NULL
              RETURNING id
            )
            INSERT INTO transport.route_variants
              (public_id, route_id, variant_code, direction_id, origin_name, destination_name,
               confidence_score, review_status, is_active)
            SELECT v.public_id, route.id, v.code, v.direction_id, v.origin, v.destination, 100, 'verified', true
            FROM route CROSS JOIN (VALUES
              ('30000000-0000-4000-8000-00000000e001'::uuid, 'D0', 0, 'E2E West', 'E2E East'),
              ('30000000-0000-4000-8000-00000000e002'::uuid, 'D1', 1, 'E2E East', 'E2E West')
            ) v(public_id, code, direction_id, origin, destination)
            ON CONFLICT (public_id) DO UPDATE SET is_active = true, deleted_at = NULL;
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO transport.stops
              (public_id, stop_code, name, name_en, mode, stop_type, geom,
               confidence_score, review_status, is_active)
            VALUES
              ('40000000-0000-4000-8000-00000000e001', 'E2E-1', 'E2E Stop 1', 'E2E Stop 1', 'bus', 'platform', ST_SetSRID(ST_MakePoint(96.2000,16.7600),4326), 100, 'verified', true),
              ('40000000-0000-4000-8000-00000000e002', 'E2E-2', 'E2E Stop 2', 'E2E Stop 2', 'bus', 'platform', ST_SetSRID(ST_MakePoint(96.2020,16.7620),4326), 100, 'verified', true)
            ON CONFLICT (public_id) DO UPDATE SET is_active = true, deleted_at = NULL;
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO transport.route_stops (route_variant_id, stop_id, stop_sequence)
            SELECT v.id, s.id, x.seq
            FROM (VALUES
              ('30000000-0000-4000-8000-00000000e001'::uuid, '40000000-0000-4000-8000-00000000e001'::uuid, 1),
              ('30000000-0000-4000-8000-00000000e001'::uuid, '40000000-0000-4000-8000-00000000e002'::uuid, 2),
              ('30000000-0000-4000-8000-00000000e002'::uuid, '40000000-0000-4000-8000-00000000e002'::uuid, 1),
              ('30000000-0000-4000-8000-00000000e002'::uuid, '40000000-0000-4000-8000-00000000e001'::uuid, 2)
            ) x(variant_public_id, stop_public_id, seq)
            JOIN transport.route_variants v ON v.public_id=x.variant_public_id
            JOIN transport.stops s ON s.public_id=x.stop_public_id
            ON CONFLICT (route_variant_id, stop_sequence) DO NOTHING
        `);
        await tx.$executeRawUnsafe(`
            INSERT INTO transport.route_paths
              (route_variant_id, path_kind, geom, confidence_score, review_status, is_active)
            SELECT v.id, 'official_shape',
              CASE v.direction_id
                WHEN 0 THEN ST_GeomFromText('LINESTRING(96.2 16.76,96.202 16.762)',4326)
                ELSE ST_GeomFromText('LINESTRING(96.202 16.762,96.2 16.76)',4326)
              END, 100, 'verified', true
            FROM transport.route_variants v
            WHERE v.public_id IN ('30000000-0000-4000-8000-00000000e001','30000000-0000-4000-8000-00000000e002')
              AND NOT EXISTS (SELECT 1 FROM transport.route_paths p WHERE p.route_variant_id=v.id);
        `);
    });
    console.log(JSON.stringify({ email: EMAIL, route: "YBS-E2E", d0: "30000000-0000-4000-8000-00000000e001", d1: "30000000-0000-4000-8000-00000000e002" }));
}

main().finally(() => prisma.$disconnect());
