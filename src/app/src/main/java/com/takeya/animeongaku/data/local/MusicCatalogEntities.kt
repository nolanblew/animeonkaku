package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

@Entity(tableName = "songs")
data class SongEntity(
    @androidx.room.PrimaryKey val id: Long,
    val title: String,
    val artistCredit: String,
    val durationSeconds: Int? = null,
    val audioUrl: String,
    val fileSize: Long? = null
)
@Entity(tableName = "music_releases")
data class MusicReleaseEntity(
    @androidx.room.PrimaryKey val id: Long,
    val title: String,
    val artistCredit: String,
    val releaseDate: String? = null,
    val year: Int? = null,
    val artworkUrl: String? = null
)

@Entity(
    tableName = "release_tracks",
    primaryKeys = ["releaseId", "songId"],
    foreignKeys = [
        ForeignKey(
            entity = MusicReleaseEntity::class,
            parentColumns = ["id"],
            childColumns = ["releaseId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = SongEntity::class,
            parentColumns = ["id"],
            childColumns = ["songId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("songId")]
)
data class ReleaseTrackEntity(
    val releaseId: Long,
    val songId: Long,
    val discNumber: Int = 1,
    val trackNumber: Int? = null,
    val displayOrder: Int = 0
)

@Entity(
    tableName = "anime_music_releases",
    primaryKeys = ["kitsuAnimeId", "releaseId"],
    foreignKeys = [
        ForeignKey(
            entity = AnimeEntity::class,
            parentColumns = ["kitsuId"],
            childColumns = ["kitsuAnimeId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = MusicReleaseEntity::class,
            parentColumns = ["id"],
            childColumns = ["releaseId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("releaseId")]
)
data class AnimeMusicReleaseEntity(
    val kitsuAnimeId: String,
    val releaseId: Long,
    val relationshipType: String
)

@Entity(
    tableName = "theme_modes",
    foreignKeys = [
        ForeignKey(
            entity = ThemeEntity::class,
            parentColumns = ["id"],
            childColumns = ["themeId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class ThemeModeEntity(
    @androidx.room.PrimaryKey val themeId: Long,
    val tvSizeUrl: String,
    val tvSizeDurationSeconds: Int? = null,
    val tvSizeFileSize: Long? = null,
    val fullSizeSongId: Long? = null,
    val fullSizeUrl: String? = null,
    val fullSizeDurationSeconds: Int? = null,
    val fullSizeFileSize: Long? = null,
    val fullSizeSourceReleaseId: Long? = null,
    val videoUrl: String? = null,
    val videoMimeType: String? = null,
    val videoSpoiler: Boolean = false,
    val videoNsfw: Boolean = false,
    val videoEntryVersion: Int? = null
)

@Entity(tableName = "song_preferences")
data class SongPreferenceEntity(
    @androidx.room.PrimaryKey val songId: Long,
    val isLiked: Boolean = false,
    val isDisliked: Boolean = false,
    val playCount: Int = 0,
    val lastPlayedAt: Long? = null,
    val updatedAt: Long = 0L,
    val deletedAt: Long? = null
)
