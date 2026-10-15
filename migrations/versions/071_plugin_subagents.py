"""Migration 071: the subagents a user's installed plugins ship.

One row per ``agents/<name>.md`` an installed plugin carries, read into the
values a base subagent has. The user's changes to one are ordinary override
rows in ``user_subagents``, keyed ``plugin:<plugin name>/<agent>``, which
uninstall deletes with the plugin's rows in its own transaction. ``file_text`` is the file
as shipped, which export writes back and update compares against.

``(user_id, plugin_id)`` references ``user_plugins`` as the component tables
do, but ON DELETE CASCADE where they RESTRICT: a row here has no side effect
to purge, and a build that predates this table can then still uninstall a
plugin that has rows in it. Names are unique per user because a subagent is
addressed by name alone.

Rollback: ``alembic stamp 070`` first, then redeploy the previous build; it
never reads the table, and its uninstall cascades through it. ``downgrade``
drops it, and with it every plugin's subagents; the users' changes to them
stay in ``user_subagents`` as settings whose base is gone.
"""

from alembic import op

revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS plugin_subagents (
            plugin_subagent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            plugin_id UUID NOT NULL,
            name VARCHAR(128) NOT NULL,
            description TEXT NOT NULL,
            instructions TEXT NOT NULL DEFAULT '',
            tools TEXT[] NOT NULL DEFAULT '{}',
            model TEXT NULL,
            effort TEXT NULL,
            search_provider TEXT NULL,
            search_depth TEXT NULL,
            connectors BOOLEAN NOT NULL DEFAULT TRUE,
            brokerages VARCHAR(8) NOT NULL DEFAULT 'on',
            preferred_connectors TEXT[] NOT NULL DEFAULT '{}',
            preferred_skills TEXT[] NOT NULL DEFAULT '{}',
            roles TEXT[] NOT NULL DEFAULT '{}',
            file_text TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT plugin_subagents_brokerages CHECK (brokerages IN ('off', 'on')),
            CONSTRAINT plugin_subagents_plugin_fk
                FOREIGN KEY (user_id, plugin_id)
                REFERENCES user_plugins(user_id, user_plugin_id)
                ON DELETE CASCADE,
            CONSTRAINT uq_plugin_subagents_user_name UNIQUE (user_id, name)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_plugin_subagents_plugin
        ON plugin_subagents(plugin_id)
    """)
    op.execute(
        "DROP TRIGGER IF EXISTS update_plugin_subagents_updated_at ON plugin_subagents"
    )
    op.execute("""
        CREATE TRIGGER update_plugin_subagents_updated_at
        BEFORE UPDATE ON plugin_subagents
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS plugin_subagents CASCADE")
