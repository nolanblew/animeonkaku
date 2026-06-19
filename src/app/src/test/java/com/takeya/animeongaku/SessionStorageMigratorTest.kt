package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.SessionStorageMigrator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStorageMigratorTest {

    @Test
    fun `copies token and server keys from legacy store on first run`() {
        val legacy = FakeSharedPreferences().apply {
            edit()
                .putString("ongaku_server_token", "legacy-token")
                .putString("ongaku_server_kitsu_user_id", "uid-9")
                .putString("ongaku_server_username", "nblew")
                .putString("ongaku_server_base_url", "https://ongaku.example/")
                .putLong("ongaku_server_pull_cursor", 42L)
                .apply()
        }
        val session = FakeSharedPreferences()

        SessionStorageMigrator(session, legacy).migrateIfNeeded()

        assertEquals("legacy-token", session.getString("ongaku_server_token", null))
        assertEquals("uid-9", session.getString("ongaku_server_kitsu_user_id", null))
        assertEquals("https://ongaku.example/", session.getString("ongaku_server_base_url", null))
        assertEquals(42L, session.getLong("ongaku_server_pull_cursor", 0L))
    }

    @Test
    fun `does not re-copy after migration flag is set`() {
        val legacy = FakeSharedPreferences().apply {
            edit().putString("ongaku_server_token", "legacy-token").apply()
        }
        val session = FakeSharedPreferences()
        val migrator = SessionStorageMigrator(session, legacy)

        migrator.migrateIfNeeded()
        // User signs out -> session token cleared
        session.edit().remove("ongaku_server_token").apply()
        // Second run must NOT resurrect the legacy token
        migrator.migrateIfNeeded()

        assertNull(session.getString("ongaku_server_token", null))
    }

    @Test
    fun `survives a legacy store that throws on read`() {
        val throwing = object : android.content.SharedPreferences by FakeSharedPreferences() {
            override fun getAll(): MutableMap<String, *> = throw IllegalStateException("corrupt keyset")
            override fun contains(key: String): Boolean = throw IllegalStateException("corrupt keyset")
        }
        val session = FakeSharedPreferences()

        SessionStorageMigrator(session, throwing).migrateIfNeeded()

        // No crash, migration flag still set so we never retry the broken store
        assertTrue(session.getBoolean("tether_storage_migrated", false))
        assertNull(session.getString("ongaku_server_token", null))
    }
}
