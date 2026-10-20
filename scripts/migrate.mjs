try { process.loadEnvFile(); } catch {}
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log("Starting database migrations...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Status migration
    console.log("Migrating placement_applications statuses to uppercase...");
    const statusUpdateRes = await client.query(`
      UPDATE placement_applications
      SET status = CASE status
        WHEN 'Applied' THEN 'APPLIED'
        WHEN 'Test' THEN 'TEST'
        WHEN 'Interview' THEN 'INTERVIEW'
        WHEN 'Offer' THEN 'ACCEPTED'
        WHEN 'Rejected' THEN 'REJECTED'
        WHEN 'Withdrawn' THEN 'WITHDRAWN'
        ELSE status
      END
      WHERE status IN ('Applied', 'Test', 'Interview', 'Offer', 'Rejected', 'Withdrawn');
    `);
    console.log(`Updated ${statusUpdateRes.rowCount} application status row(s).`);

    // 2. Add columns to placement_applications
    console.log("Ensuring new columns on placement_applications...");
    await client.query(`
      ALTER TABLE placement_applications
        ADD COLUMN IF NOT EXISTS stage_detail text,
        ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS last_email_at timestamptz,
        ADD COLUMN IF NOT EXISTS next_at timestamptz,
        ADD COLUMN IF NOT EXISTS next_at_has_time boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS next_type text,
        ADD COLUMN IF NOT EXISTS action_required boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS action_note text;
    `);

    // 3. Create connected_accounts table
    console.log("Ensuring connected_accounts table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS connected_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES placement_users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        google_email text,
        encrypted_refresh_token text,
        label_id text,
        label_name text,
        status text NOT NULL DEFAULT 'active',
        last_synced_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT connected_accounts_user_provider_unique UNIQUE (user_id, provider)
      );
    `);

    // 4. Create sender_rules table
    console.log("Ensuring sender_rules table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS sender_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES placement_users(id) ON DELETE CASCADE,
        kind text NOT NULL,
        value text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        source text NOT NULL DEFAULT 'detected',
        message_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sender_rules_user_kind_value_unique UNIQUE (user_id, kind, value)
      );
    `);

    // 5. Create email_events table
    console.log("Ensuring email_events table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES placement_users(id) ON DELETE CASCADE,
        gmail_message_id text NOT NULL UNIQUE,
        thread_id text,
        from_address text,
        from_domain text,
        subject text,
        received_at timestamptz,
        status text NOT NULL DEFAULT 'pending_sender',
        ai_result jsonb,
        confidence numeric,
        application_id uuid REFERENCES placement_applications(id) ON DELETE SET NULL,
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS email_events_user_thread_idx ON email_events (user_id, thread_id);
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS content_fingerprint text;
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS match_method text;
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS review_reason text;
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS candidate_application_ids jsonb;
      ALTER TABLE email_events ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
      CREATE INDEX IF NOT EXISTS email_events_user_status_received_idx ON email_events (user_id, status, received_at);
      CREATE INDEX IF NOT EXISTS email_events_user_fingerprint_idx ON email_events (user_id, content_fingerprint);
    `);

    // 6. Create application_events table
    console.log("Ensuring application_events table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES placement_users(id) ON DELETE CASCADE,
        application_id uuid NOT NULL REFERENCES placement_applications(id) ON DELETE CASCADE,
        email_event_id uuid REFERENCES email_events(id) ON DELETE SET NULL,
        kind text NOT NULL,
        occurred_at timestamptz NOT NULL,
        from_status text,
        to_status text,
        stage_detail text,
        summary text,
        before jsonb,
        after jsonb,
        applied_by text NOT NULL,
        undone_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS application_events_app_occurred_idx ON application_events (application_id, occurred_at);
      CREATE INDEX IF NOT EXISTS application_events_user_idx ON application_events (user_id);
    `);

    // 7. Create reminder_dismissals table
    console.log("Ensuring reminder_dismissals table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS reminder_dismissals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES placement_users(id) ON DELETE CASCADE,
        reminder_key text NOT NULL,
        dismissed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT reminder_dismissals_user_key_unique UNIQUE (user_id, reminder_key)
      );
      CREATE INDEX IF NOT EXISTS reminder_dismissals_user_id_idx ON reminder_dismissals (user_id);
    `);

    await client.query("COMMIT");
    console.log("All database migrations completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

